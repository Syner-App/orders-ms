import { IsMongoId, IsUUID } from 'class-validator';

export class PurchaseOrderByIdDto {
  // Organization of the authenticated caller, set by client-gateway from the verified token
  @IsMongoId()
  public organization_id: string;

  @IsUUID(4)
  public id: string;
}
