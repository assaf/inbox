/** Minimal fake VercelResponse for exercising API handlers in tests. */
export interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  send(body: unknown): FakeRes;
  setHeader(name: string, value: string): FakeRes;
  end(): FakeRes;
}

export function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader() {
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}
