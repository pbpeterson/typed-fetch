/**
 * A transport double that records what it was handed.
 *
 * Six spec files had written this by hand, in five slightly different shapes:
 * one recorded only the input, one only answered a 204, one took the response
 * to answer with. The differences carried no meaning, and the copies drifted —
 * a test that needed the init had to be moved to the file whose copy recorded
 * it. One shape records both slots and takes the answer, so every caller uses
 * the same double.
 *
 * The arrays are the recording. They are read after the call, never written by
 * a caller, so a structural comparison against a value the transport received
 * is safe to make on them rather than on the value itself.
 */
export interface RecordingTransport {
  /** Pass this as `options.fetch`, or install it on the global. */
  readonly fetch: typeof fetch;
  /** The first argument of each call, in call order. */
  readonly inputs: unknown[];
  /** The second argument of each call, in call order. */
  readonly inits: unknown[];
}

/**
 * Build a recording transport.
 *
 * @param respond - What each call answers with. Defaults to a 204 with no body,
 *   which is the answer a test that is not about the response wants: it carries
 *   no body to release and no status to classify.
 */
export function recordingTransport(
  respond: () => Response | Promise<Response> = () => new Response(null, { status: 204 }),
): RecordingTransport {
  const inputs: unknown[] = [];
  const inits: unknown[] = [];
  const impl = async (input: unknown, init: unknown): Promise<Response> => {
    inputs.push(input);
    inits.push(init);
    return respond();
  };
  return { fetch: impl as unknown as typeof fetch, inputs, inits };
}
