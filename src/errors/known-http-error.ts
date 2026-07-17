import { BaseHttpError } from "./base-http-error";
import { brand, knownHttpErrorBrand } from "./brand";

/**
 * Internal base for the library's dedicated HTTP status classes.
 *
 * It deliberately remains outside the public barrels. Consumers may extend
 * {@link BaseHttpError}, but their subclasses are not members of the closed
 * `ClientErrors | ServerErrors` union returned by `typedFetch` and therefore
 * must not satisfy `isKnownHttpError`.
 */
export abstract class KnownHttpError extends BaseHttpError {}

// A separate brand from BaseHttpError is what makes `isKnownHttpError` sound:
// the 40 dedicated classes inherit it, while UnknownHttpError and consumer
// subclasses of the public BaseHttpError do not.
brand(KnownHttpError.prototype, knownHttpErrorBrand);
