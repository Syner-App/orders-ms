import { IsUUID } from 'class-validator';

export class OrderByIdDto {
  @IsUUID(4)
  public id: string;
}
