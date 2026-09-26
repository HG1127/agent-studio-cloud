interface ComparableRunFeedback {
  rating: string;
  note: string | null;
}

export function runFeedbackMatches(current: ComparableRunFeedback, requested: ComparableRunFeedback): boolean {
  return current.rating === requested.rating && current.note === requested.note;
}
