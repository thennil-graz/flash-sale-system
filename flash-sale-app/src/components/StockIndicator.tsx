import styled from 'styled-components';

type StockState = 'in_stock' | 'low_stock' | 'sold_out' | 'limit_exceeded';

interface Props {
  stock: number;
  purchaseLimitExceeded?: boolean;
}

function getState(stock: number, limitExceeded: boolean): StockState {
  if (limitExceeded) return 'limit_exceeded';
  if (stock <= 0) return 'sold_out';
  if (stock <= 3) return 'low_stock';
  return 'in_stock';
}

export function StockIndicator({ stock, purchaseLimitExceeded = false }: Props) {
  const state = getState(stock, purchaseLimitExceeded);

  const labels: Record<StockState, string> = {
    in_stock:       'IN STOCK',
    low_stock:      `Only ${stock} left`,
    sold_out:       'SOLD OUT',
    limit_exceeded: 'PURCHASE LIMIT EXCEEDED',
  };

  return <StyledIndicator $state={state}>{labels[state]}</StyledIndicator>;
}

const StyledIndicator = styled.span<{ $state: StockState }>`
  display: inline-block;
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.sm}`};
  border-radius: ${({ theme }) => theme.radii.sm};

  ${({ theme, $state }) => {
    switch ($state) {
      case 'in_stock':
        return `color: ${theme.colors.success}; background: ${theme.colors.success}18;`;
      case 'low_stock':
        return `color: ${theme.colors.warning}; background: ${theme.colors.warning}18;`;
      case 'sold_out':
      case 'limit_exceeded':
        return `color: ${theme.colors.error}; background: ${theme.colors.error}18;`;
    }
  }}
`;
