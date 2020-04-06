
import { SympyStringify, parseSympyExpression, SympyToken } from "./sympy-parser";
import { SympyRESTClient } from "./sympy-rest-client";
import { fromSympy } from "./from-sympy";
import { BaseSymPyVisitor, InvalidNodeError } from "./to-sympy";
import { unquote, getAnyVariable, getAnyVariableFromNodes } from "./utils";
import { SemanticErrorDescription, MathNode, MathNodeVisitor, acceptMathNode, MathDifferential, MathSet, MathSystemOfEquations, HttpClient, MathStructure, MathNumber, MathUnaryMinus, MathVariable } from "semantic-math-editor";
import { PreparedSympyCall, EquivResponse, PlotInterval, Plot2dParams, SympyError, Plot3dParams } from "./model";

class BrowserBasedHttpClient implements HttpClient {

  requestAsync<Request, Response>(
    method: 'GET' | 'POST',
    url: string,
    content?: Request,
    callback?: (response: Response) => void,
    errorCallback?: (err: any) => void) {

    const request = new XMLHttpRequest();
    request.open(method, url, true);
    request.onload = function () {

      if (this.status >= 200 && this.status < 400) {
        // Success!
        const data = JSON.parse(this.response) as Response;
        callback && callback(data);
      } else {
        // We reached our target server, but it returned an error
        errorCallback && errorCallback("bad HTTP status:" + this.status);
      }
    };

    request.onerror = function (err) {
      // There was a connection error of some sort
      errorCallback && errorCallback(err);
    };
    if (method === 'POST') {
      request.setRequestHeader(
        'Content-Type',
        'application/json;charset=UTF-8');
    }
    request.send(JSON.stringify(content));
  }
}

export class SympyClient {

  private readonly client: SympyRESTClient;

  constructor(serverAddress: string, http?: HttpClient) {
    this.client = new SympyRESTClient(serverAddress, http ? http : new BrowserBasedHttpClient());
  }

  /**
   * Converts MathTree from the MatEditor to SympyCall
   * Alternatively returns MathEditor's {SemanticErrorDescription} (if converting is not possible)
   * The SemanticErrorDescription object can be used to decorate problematic node in the MathEditor
   * @param node
   */
  prepareCompute(node: MathNode): PreparedSympyCall | SemanticErrorDescription {
    return this.prepare(node, ComputeOperation.instance);
  }

  /**
   * Returns the same expression as sympy has understood it
   * The returned expression is equivavlent to entered one (but not equal in genearl case)
   * The goal of this method is to ensure sympy understands the expression
   * It is for use with tests 
   * @param sympyExpression - the result of one of "prepare...()" methods
   * @param log - if true, writes debug info to the console
   * @throws {SympyError}
   */
  async mirror(sympyExpression: PreparedSympyCall, log?: boolean): Promise<MathNode> {
    const args = sympyExpression.token.accept(SympyStringify.instance);
    if (log) {
      console.log("RAW EXPRESSION TO SEND TO SYMPY: " + args);
    }
    const sympyResult = await this.client.callCustom<string>("mirror", [args]);
    try {
      if (log) {
        console.log("RAW RESULT FROM SYMPY: " + sympyResult);
      }
      const sympyParsedExpression = parseSympyExpression(sympyResult);
      if (log) {
        console.log("PARSED RESULT FROM SYMPY: " + JSON.stringify(sympyParsedExpression));
      }
      return fromSympy(sympyParsedExpression);
    }
    catch (e) {
      console.log("RAW RESULT FROM SYMPY: " + sympyResult);
      throw e;
    }
  }

  async checkEquivalence(exp1: PreparedSympyCall, exp2: PreparedSympyCall): Promise<EquivResponse> {
    const args = [exp1.stringify(), exp2.stringify()];
    return this.client.callCustom<EquivResponse>("equiv", args);
  }

  /**
   * Returns the result of sympy .doit() method on the provided expression.
   * @param sympyExpression - the result of one of "prepareCompute()" method
   * @throws {SympyError}
   */
  async compute(sympyExpression: PreparedSympyCall): Promise<MathNode> {
    const sympyResult = await this.client.callMethod(sympyExpression.token.accept(SympyStringify.instance), "doit", []);
    const sympyParsedExpression = parseSympyExpression(sympyResult);
    return fromSympy(sympyParsedExpression);
  }


  async simplify(sympyExpression: PreparedSympyCall, log?: boolean): Promise<MathNode> {
    const sympyResult = await this.client.callFunction("simplify", [sympyExpression.stringify()],{"doit":false});
    try {
      if (log) {
        console.log("RAW RESULT FROM SYMPY: " + sympyResult);
      }
      const sympyParsedExpression = parseSympyExpression(sympyResult);
      if (log) {
        console.log("PARSED RESULT FROM SYMPY: " + JSON.stringify(sympyParsedExpression));
      }
      return fromSympy(sympyParsedExpression);
    }
    catch (e) {
      console.log("RAW RESULT FROM SYMPY: " + sympyResult);
      throw e;
    }

  }

  /**
   * Returns the LaTex representation of the given parameter
   * Note: it is generated by Sympy and in most cases this latex can't be pasted to MathEditor
   * It only can be shown using KaTex or some other Latex renderer
   * @param sympyExpression - the result of one of "prepareCompute()" method
   * @throws {SympyError}
   */
  async latex(sympyExpression: PreparedSympyCall): Promise<string> {
    //The first 8 backslashes means 2 of them, as they are unquoted twice (the second time by the RegExp())
    //The second 2 backslashes means 1 of them as this gets unquoted only once
    //The whole code is here because SymPy returns escaped backslashes, so there is \\left( instead of \left(
    return this.replaceAll(unquote(await this.client.callFunction("latex", [sympyExpression.token.accept(SympyStringify.instance)])), "\\\\\\\\", "\\");
  }

  plot2dSrc(sympyExpression: PreparedSympyCall[], svg: boolean, interval?: PlotInterval, params?: Plot2dParams): string {
    const args: string[] = sympyExpression.map(e => e.stringify());
    if (interval) {
      args.push(interval.asSympyTuple());
    }
    return this.client.plotSrc("plot", args, svg, params);
  }

  plot2dParametricSrc(expressionPairs: { x: PreparedSympyCall, y: PreparedSympyCall }[], svg: boolean, interval?: PlotInterval, params?: Plot2dParams): string {
    const args: string[] = expressionPairs.map(e => {
      return "(" + e.x.stringify() + "," + e.y.stringify() + ")";
    });
    if (interval) {
      args.push(interval.asSympyTuple());
    }
    return this.client.plotSrc("plot_parametric", args, svg, params);
  }



  plot3dSrc(sympyExpression: PreparedSympyCall[], svg: boolean, intervals?: { i1: PlotInterval, i2: PlotInterval }, params?: Plot3dParams): string {
    const args: string[] = sympyExpression.map(e => e.stringify());
    if (intervals) {
      args.push(intervals.i1.asSympyTuple());
      args.push(intervals.i2.asSympyTuple());
    }
    return this.client.plotSrc("plot3d", args, svg, params);
  }

  preparePlotInterval(v: MathVariable, start?: number, end?: number): PlotInterval {
    const self = this;

    if (!start) {
      start = -10;
    }
    if (!end) {
      end = 10;
    }
    return new PlotInterval(this.prepareCompute(v) as PreparedSympyCall, toMathNode(start), toMathNode(end));

    function toMathNode(num: number): PreparedSympyCall {
      if (num < 0) {
        return self.prepareCompute(new MathUnaryMinus(new MathNumber("" + Math.abs(num)))) as PreparedSympyCall;
      }
      else {
        return self.prepareCompute(new MathNumber("" + num)) as PreparedSympyCall;
      }

    }
  }

  plot3dParametricLineSrc(expressionPairs: { x: PreparedSympyCall, y: PreparedSympyCall, z: PreparedSympyCall, interval: PlotInterval }[], svg: boolean, params?: Plot3dParams): string {
    const args: string[] = expressionPairs.map(e => {
      return "(" + e.x.stringify() + "," + e.y.stringify() + "," + e.z.stringify() + "," + e.interval.asSympyTuple() + ")";
    });
    return this.client.plotSrc("plot3d_parametric_line", args, svg, params);
  }

  plot3dParametricSurfaceSrc(expressionPairs: { x: PreparedSympyCall, y: PreparedSympyCall, z: PreparedSympyCall, r_u: PlotInterval, r_v: PlotInterval }[], svg: boolean, params?: Plot3dParams): string {
    const args: string[] = expressionPairs.map(e => {
      return "(" + e.x.stringify() + "," + e.y.stringify() + "," + e.z.stringify() + "," + e.r_u.asSympyTuple() + "," + e.r_v.asSympyTuple() + ")";
    });
    return this.client.plotSrc("plot3d_parametric_surface", args, svg, params);
  }

  //plot3d_parametric_surface

  plot2d(sympyExpressions: PreparedSympyCall[], svg: boolean, onError?: (err: SympyError) => void, interval?: PlotInterval, params?: Plot2dParams): HTMLImageElement {
    const img = document.createElement("img");
    const self = this;
    if (onError) {
      img.onerror = () => {
        const args: string[] = sympyExpressions.map(e => e.stringify());
        if (interval) {
          args.push(interval.asSympyTuple());
        }
        self.client.checkPlotValidity("plot", args, svg, params).catch(
          (err: SympyError) => {
            onError(err);
          }
        );
      }
    }
    img.src = this.plot2dSrc(sympyExpressions, svg, interval, params);
    return img;
  }

  plot3d(sympyExpressions: PreparedSympyCall[], svg: boolean, onError?: (err: SympyError) => void, intervals?: { i1: PlotInterval, i2: PlotInterval }, params?: Plot3dParams): HTMLImageElement {
    const img = document.createElement("img");
    const self = this;
    if (onError) {
      img.onerror = () => {
        const args: string[] = sympyExpressions.map(e => e.stringify());
        if (intervals) {
          args.push(intervals.i1.asSympyTuple());
          args.push(intervals.i2.asSympyTuple());
        }
        self.client.checkPlotValidity("plot3d", args, svg, params).catch(
          (err: SympyError) => {
            onError(err);
          }
        );
      }
    }
    img.src = this.plot3dSrc(sympyExpressions, svg, intervals, params);
    return img;
  }

  plot2d_parametric(expressionPairs: { x: PreparedSympyCall, y: PreparedSympyCall }[], svg: boolean, onError?: (err: SympyError) => void, interval?: PlotInterval, params?: Plot2dParams): HTMLImageElement {
    const img = document.createElement("img");
    const self = this;
    if (onError) {
      img.onerror = () => {
        const args: string[] = expressionPairs.map(e => {
          return "(" + e.x.stringify() + "," + e.y.stringify() + ")";
        });
        if (interval) {
          args.push(interval.asSympyTuple());
        }
        self.client.checkPlotValidity("plot_parametric", args, svg, params).catch(
          (err: SympyError) => {
            onError(err);
          }
        );
      }
    }
    img.src = this.plot2dParametricSrc(expressionPairs, svg, interval, params);
    return img;
  }

  plot3d_parametric_line(expressionPairs: { x: PreparedSympyCall, y: PreparedSympyCall, z: PreparedSympyCall, interval: PlotInterval }[], svg: boolean, onError?: (err: SympyError) => void, params?: Plot3dParams): HTMLImageElement {
    const img = document.createElement("img");
    const self = this;
    if (onError) {
      img.onerror = () => {
        const args: string[] = expressionPairs.map(e => {
          return "(" + e.x.stringify() + "," + e.y.stringify() + "," + e.z.stringify() + "," + e.interval.asSympyTuple() + ")";
        });
        self.client.checkPlotValidity("plot3d_parametric_line", args, svg, params).catch(
          (err: SympyError) => {
            onError(err);
          }
        );
      }
    }
    img.src = this.plot3dParametricLineSrc(expressionPairs, svg, params);
    return img;
  }

  plot3d_parametric_surface(expressionPairs: { x: PreparedSympyCall, y: PreparedSympyCall, z: PreparedSympyCall, r_u: PlotInterval, r_v: PlotInterval }[], svg: boolean, onError?: (err: SympyError) => void, params?: Plot3dParams): HTMLImageElement {
    const img = document.createElement("img");
    const self = this;
    if (onError) {
      img.onerror = () => {
        const args: string[] = expressionPairs.map(e => {
          return "(" + e.x.stringify() + "," + e.y.stringify() + "," + e.z.stringify() + "," + e.r_u.asSympyTuple() + "," + e.r_v.asSympyTuple() + ")";
        });
        self.client.checkPlotValidity("plot3d_parametric_surface", args, svg, params).catch(
          (err: SympyError) => {
            onError(err);
          }
        );
      }
    }
    img.src = this.plot3dParametricSurfaceSrc(expressionPairs, svg, params);
    return img;
  }

  private replaceAll(target: string, search: string, replacement: string) {
    return target.replace(new RegExp(search, 'g'), replacement);
  };

  protected prepare(node: MathNode, operation: MathNodeVisitor<SympyToken>): PreparedSympyCall | SemanticErrorDescription {
    try {
      return new PreparedSympyCall(acceptMathNode(node, operation));
    }
    catch (e) {
      if (e instanceof InvalidNodeError) {
        return e.error;
      }
      throw e;
    }
  }
}

class ComputeOperation extends BaseSymPyVisitor {

  static readonly instance = new ComputeOperation();

  visitDifferential(mathNode: MathDifferential): SympyToken {
    throw new InvalidNodeError(mathNode, "compute operation does not support standalone differential");
  }
  visitSet(mathNode: MathSet): SympyToken {
    throw new InvalidNodeError(mathNode, "compute operation does not support sets");
  }
  visitSystemOfEquations(mathNode: MathSystemOfEquations): SympyToken {
    throw new InvalidNodeError(mathNode, "compute operation does not support system of equations");
  }

}