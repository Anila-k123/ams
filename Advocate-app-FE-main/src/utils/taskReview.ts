/** Mirrors workspace/review.py can_review: the assigner, or another member with
 *  TASK_ASSIGN, may review a submitted delegated task; never its assignee. */
export const canReviewTask = (task, myId, canAssign) =>
  !!task.needsReview && task.reviewStatus === "SUBMITTED" && task.assignedToId !== myId
  && (task.assignedById === myId || canAssign);
