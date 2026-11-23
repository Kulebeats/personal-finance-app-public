import { HttpError } from "./HttpError";

/** Only reveal verification state after a current session or valid credential. */
export class EmailVerificationRequiredError extends HttpError {
  readonly statusCode = 403;
  readonly code = "EMAIL_VERIFICATION_REQUIRED";
  constructor() { super("Email not verified. Please check your inbox."); }
}
