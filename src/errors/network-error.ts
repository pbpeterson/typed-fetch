export class NetworkError extends Error {
  override readonly name = "NetworkError";

  constructor(message: string = "Network error") {
    super(message);
  }
}
