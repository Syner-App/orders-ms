import { IsInt, IsMongoId, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePurchaseOrderDto {
  // Organization of the authenticated caller, set by client-gateway from the verified token
  @IsMongoId()
  public organization_id: string;

  @IsInt()
  @IsPositive()
  public producto_id: number;

  @IsString()
  @IsNotEmpty()
  public proveedor: string;

  @IsInt()
  @IsPositive()
  public cantidad_solicitada: number;

  @IsString()
  @IsOptional()
  public motivo?: string;
}
