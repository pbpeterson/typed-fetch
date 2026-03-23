export abstract class BaseHttpError extends Error {
  public readonly headers: Headers;
  public abstract readonly status: number;
  public abstract readonly statusText: string;

  constructor(protected readonly response: Response) {
    super();
    this.name = this.constructor.name;
    this.headers = response.headers;
  }

  async json<T = unknown>(): Promise<T> {
    return this.response.json();
  }

  async text(): Promise<string> {
    return this.response.text();
  }

  async blob(): Promise<Blob> {
    return this.response.blob();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer();
  }

  abstract clone(): BaseHttpError;
}