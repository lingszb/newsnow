export class SplittableClassifierError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SplittableClassifierError"
  }
}

export class ClassifierArticleIdError extends SplittableClassifierError {}
export class ClassifierTimeoutError extends SplittableClassifierError {}
