export class NetworkError extends Error {
  constructor(message: string = "Network error") {
    super(message);
  }
}
