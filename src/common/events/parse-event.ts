import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

const constraintMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...constraintMessages(error.children ?? []),
  ]);

// RMQ handlers validate their own payloads: a failure in the global
// ValidationPipe would skip the handler and leave the message un-acked
export async function parseEvent<T extends object>(
  cls: ClassConstructor<T>,
  payload: unknown,
): Promise<{ event: T } | { errors: string }> {
  if (typeof payload !== 'object' || payload === null) {
    return { errors: 'payload must be an object' };
  }

  const event = plainToInstance(cls, payload);
  const errors = await validate(event, { whitelist: true });

  if (errors.length) {
    return { errors: constraintMessages(errors).join(', ') };
  }
  return { event };
}
