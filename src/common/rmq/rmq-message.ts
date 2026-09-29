import type { RmqContext } from '@nestjs/microservices';
import type { Channel, Message } from 'amqplib';

// Manual acknowledgement helpers (servers run with noAck: false)
export function rmqMessage(context: RmqContext) {
  const channel = context.getChannelRef() as Channel;
  const message = context.getMessage() as Message;

  return {
    redelivered: message.fields.redelivered,
    ack: () => channel.ack(message),
    nack: (requeue: boolean) => channel.nack(message, false, requeue),
  };
}
