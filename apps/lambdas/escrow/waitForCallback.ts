/**
 * waitForCallback — Lambda handler
 *
 * Step Functions Task Token recipient. This Lambda is invoked by SFN
 * when a state needs external input (webhook, admin action, etc.).
 *
 * The Lambda simply passes through — the real work is done by the
 * webhook handler or admin API calling SendTaskSuccess/SendTaskFailure
 * on the state machine. This Lambda exists so SFN has a target ARN
 * for the .waitForTaskToken integration pattern.
 *
 * Used by:
 *   - WaitForFunding (webhook resumes when payment received)
 *   - WaitForShipment (carrier confirms delivery)
 *   - ManualReview (super_admin resolves dispute)
 */

export const handler = async (event: { taskToken?: string; input?: unknown }) => {
  // This Lambda is a passthrough callback target.
  // The state machine passes the task token; external systems
  // call SendTaskSuccess/SendTaskFailure on the SFN execution.

  console.log("waitForCallback invoked", { taskToken: event.taskToken ? "present" : "missing" });

  return {
    status: "waiting",
    message: "This Lambda is a callback target. The state machine will resume when a webhook or admin action provides the resolution.",
  };
};
