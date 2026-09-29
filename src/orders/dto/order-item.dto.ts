import { IsInt, IsPositive } from "class-validator";

export class OrderItemDto {

    @IsInt()
    @IsPositive()
    productId: number;

    @IsInt()
    @IsPositive()
    quantity: number;
}
