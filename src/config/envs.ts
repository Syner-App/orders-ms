import 'dotenv/config';

import Joi from 'joi';

interface EnvVars {
    PORT: number;
    DATABASE_URL: string;
    RABBITMQ_URL: string;
    OUTBOX_POLL_INTERVAL_MS: number;
    ORDER_VALIDATION_TIMEOUT_MS: number;
    SAGA_TIMEOUT_CHECK_INTERVAL_MS: number;
}

const envsSchema = Joi.object({
    PORT: Joi.number().required(),
    DATABASE_URL: Joi.string().required(),
    RABBITMQ_URL: Joi.string().required(),
    OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().positive().default(1000),
    ORDER_VALIDATION_TIMEOUT_MS: Joi.number().integer().positive().default(300_000),
    SAGA_TIMEOUT_CHECK_INTERVAL_MS: Joi.number().integer().positive().default(60_000),
}).unknown(true);

const { error, value } = envsSchema.validate(process.env);

if (error) {
     throw new Error(`Config validation error: ${ error }`);
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    databaseUrl: envVars.DATABASE_URL,
    rabbitmqUrl: envVars.RABBITMQ_URL,
    outboxPollIntervalMs: envVars.OUTBOX_POLL_INTERVAL_MS,
    orderValidationTimeoutMs: envVars.ORDER_VALIDATION_TIMEOUT_MS,
    sagaTimeoutCheckIntervalMs: envVars.SAGA_TIMEOUT_CHECK_INTERVAL_MS,
}
