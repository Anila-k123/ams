/** Mirrors workspace/review.py can_review: the assigner, or another member with
 *  TASK_ASSIGN, may review a submitted delegated task; never its assignee. */
export const canReviewTask = (task, myId, canAssign) =>
  !!task.needsReview && task.reviewStatus === "SUBMITTED" && task.assignedToId !== myId
  && (task.assignedById === myId || canAssign);

/** The assignee may hand a delegated task back (again, after changes were asked). */
export const canSubmitTask = (task, myId) =>
  !!task.needsReview && task.assignedToId === myId && !task.completed && !task.cancelled
  && task.reviewStatus !== "SUBMITTED" && task.reviewStatus !== "APPROVED";
