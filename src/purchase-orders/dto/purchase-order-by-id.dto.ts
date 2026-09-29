import { IsUUID } from 'class-validator';

export class PurchaseOrderByIdDto {
  @IsUUID(4)
  public id: string;
}
