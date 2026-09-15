export class AppError extends Error {
  isOperational: boolean;
  status: number;

  constructor({ message, status }: { message: string; status: number }) {
    super(message);
    this.isOperational = true;
    this.status = status;
  }

  toResponse() {
    return Response.json(
      {
        error: {
          message: this.message,
          code: this.status,
        },
      },
      { status: this.status },
    );
  }
}
