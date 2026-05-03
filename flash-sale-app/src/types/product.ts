export interface Product {
  id: string;
  name: string;
  description: string | null;
  stock: number;
  price: number;
  saleStartDate: string | null;
  saleEndDate: string | null;
}
