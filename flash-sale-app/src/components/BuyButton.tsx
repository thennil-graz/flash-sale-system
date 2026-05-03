import styled from 'styled-components';
import { OrderStatus } from '../types/order';

interface Props {
  orderStatus: OrderStatus;
  salePhase: 'upcoming' | 'ongoing' | 'ended';
  stock: number;
  purchaseLimitExceeded: boolean;
  onClick: () => void;
}

export function BuyButton({ orderStatus, salePhase, stock, purchaseLimitExceeded, onClick }: Props) {
  const saleOngoing = salePhase === 'ongoing';

  const isDisabled =
    !saleOngoing ||
    stock <= 0 ||
    purchaseLimitExceeded ||
    orderStatus === 'pending' ||
    orderStatus === 'success';

  const label = () => {
    if (orderStatus === 'pending') return 'Processing…';
    if (orderStatus === 'success') return 'Order Placed';
    if (salePhase === 'ended') return 'Sale Ended';
    if (stock <= 0) return 'Sold Out';
    if (purchaseLimitExceeded) return 'Limit Exceeded';
    if (!saleOngoing) return 'Sale Not Started';
    return 'Buy Now';
  };

  return (
    <StyledButton onClick={onClick} disabled={isDisabled} $status={orderStatus} $active={!isDisabled}>
      {label()}
    </StyledButton>
  );
}

const StyledButton = styled.button<{ $status: OrderStatus; $active: boolean }>`
  width: 100%;
  min-height: 56px;
  border: none;
  border-radius: ${({ theme }) => theme.radii.md};
  font-family: ${({ theme }) => theme.typography.fontFamily};
  font-size: ${({ theme }) => theme.typography.sizes.md};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  cursor: ${({ $active }) => ($active ? 'pointer' : 'not-allowed')};
  transition: background 0.15s ease, transform 0.1s ease;

  ${({ theme, $status, $active }) => {
    if ($status === 'success') return `background: ${theme.colors.success}; color: ${theme.colors.surface};`;
    if (!$active) return `background: ${theme.colors.border}; color: #999; border: 2px solid ${theme.colors.border};`;
    return `background: ${theme.colors.primary}; color: ${theme.colors.surface};
      &:hover { filter: brightness(1.08); transform: translateY(-1px); }
      &:active { transform: translateY(0); }`;
  }}
`;
