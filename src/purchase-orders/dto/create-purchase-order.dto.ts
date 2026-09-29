import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePurchaseOrderDto {
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
