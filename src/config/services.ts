export const ORDERS_EVENTS_CLIENT = 'ORDERS_EVENTS_CLIENT';

// Topic exchange shared by every Syner service. It and the work queues are declared
// in syner/rabbitmq/definitions.json; queue arguments here must match that file
export const SYNER_EXCHANGE = 'syner.events';

// Dead-letter exchange (and DLQs) declared in syner/rabbitmq/definitions.json
export const SYNER_DLX = 'syner.dlx';

export const SAGA_REPLIES_QUEUE = 'orders.saga-replies';

export const PUBLISH_TIMEOUT_MS = 5000;
