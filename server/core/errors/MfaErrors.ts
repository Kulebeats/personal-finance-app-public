import { HttpError } from "./HttpError";

/** AH-11: the MFA grace has ended and this member has not enrolled yet. */
export class MfaEnrolmentRequiredError extends HttpError {
  readonly statusCode = 403;
  readonly code = "MFA_ENROLMENT_REQUIRED";
  readonly graceEndedAt: string;

  constructor(graceEndedAt: string) {
    super("Set up two-step verification to continue. You can still sign out.");
    this.graceEndedAt = graceEndedAt;
  }

  toJSON() {
    const body = super.toJSON();
    return { ...body, error: { ...body.error, details: { graceEndedAt: this.graceEndedAt } } };
  }
}

/** AH-11: after the grace, two-step verification cannot be turned off. */
export class MfaRequiredError extends HttpError {
  readonly statusCode = 409;
  readonly code = "MFA_REQUIRED";

  constructor() {
    super("Two-step verification is required for every member and can't be turned off.");
  }
}
