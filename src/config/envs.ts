import 'dotenv/config';

import Joi from 'joi';

interface EnvVars {
    PORT: number;
    DATABASE_URL: string;
    PRODUCTS_MICROSERVICE_HOST: string;
    PRODUCTS_MICROSERVICE_PORT: number;
}

const envsSchema = Joi.object({
    PORT: Joi.number().required(),
    DATABASE_URL: Joi.string().required(),
    PRODUCTS_MICROSERVICE_HOST: Joi.string().required(),
    PRODUCTS_MICROSERVICE_PORT: Joi.number().required(),
}).unknown(true);

const { error, value } = envsSchema.validate(process.env);

if (error) {
     throw new Error(`Config validation error: ${ error }`);
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    databaseUrl: envVars.DATABASE_URL,
    productsMicroserviceHost: envVars.PRODUCTS_MICROSERVICE_HOST,
    productsMicroservicePort: envVars.PRODUCTS_MICROSERVICE_PORT,
}