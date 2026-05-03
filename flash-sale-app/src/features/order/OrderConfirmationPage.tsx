import { useLocation, useNavigate } from 'react-router-dom';
import styled, { css, keyframes } from 'styled-components';
import type { OrderState } from '../../types/order';
import { useOrderStatus } from '../../hooks/useOrderStatus';

type DisplayStatus = 'pending' | 'success' | 'failed';

const STATUS_CONFIG: Record<DisplayStatus, { heading: string; subtext: string }> = {
  pending: {
    heading: 'Processing Payment…',
    subtext:  'Your order has been received. Please wait while we confirm your payment.',
  },
  success: {
    heading: 'Order Confirmed!',
    subtext:  'Your payment was successful. Thanks for your purchase.',
  },
  failed: {
    heading: 'Payment Failed',
    subtext:  'Something went wrong processing your payment. Please try again.',
  },
};

export function OrderConfirmationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const email    = sessionStorage.getItem('userEmail') ?? '';

  const order: OrderState = location.state ?? {};
  const userId    = order.userId   ?? sessionStorage.getItem('userId');
  const productId = order.productId ?? null;

  const rawStatus    = useOrderStatus(userId, productId);
  const status: DisplayStatus = rawStatus === 'idle' ? 'pending' : rawStatus as DisplayStatus;

  const { heading, subtext } = STATUS_CONFIG[status];

  return (
    <StyledPage>
      <StyledCard>
        <StyledStatusBanner $status={status}>
          {heading}
        </StyledStatusBanner>

        <StyledSubtext>{subtext}</StyledSubtext>

        <StyledSection>
          <StyledLabel>Email Address</StyledLabel>
          <StyledValue>{email || '—'}</StyledValue>
        </StyledSection>

        <StyledSection>
          <StyledLabel>Delivery Address</StyledLabel>
          <StyledValue>123 Main St, Anytown, NY 12345</StyledValue>
        </StyledSection>

        <StyledDetailsBox>
          <StyledLabel>Order Details</StyledLabel>
          {order.orderId && (
            <StyledDetailRow>
              <span>Order ID</span>
              <span>{order.orderId}</span>
            </StyledDetailRow>
          )}
          {order.productTitle && (
            <StyledDetailRow>
              <span>Product</span>
              <span>{order.productTitle}</span>
            </StyledDetailRow>
          )}
          {order.productPrice != null && (
            <StyledDetailRow>
              <span>Price</span>
              <span>${order.productPrice.toFixed(2)}</span>
            </StyledDetailRow>
          )}
          {order.quantity && (
            <StyledDetailRow>
              <span>Quantity</span>
              <span>{order.quantity}</span>
            </StyledDetailRow>
          )}
        </StyledDetailsBox>

        {status !== 'pending' && (
          <StyledBackButton onClick={() => navigate('/')}>Back to Sale</StyledBackButton>
        )}
      </StyledCard>
    </StyledPage>
  );
}

const StyledPage = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.neutral100};
  padding: ${({ theme }) => theme.spacing.md};
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const StyledCard = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.radii.lg};
  box-shadow: ${({ theme }) => theme.shadows.elevated};
  padding: ${({ theme }) => theme.spacing.xl};
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
`;

const StyledStatusBanner = styled.h1<{ $status: DisplayStatus }>`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.lg};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radii.md};
  text-align: center;

  ${({ theme, $status }) => {
    if ($status === 'success') return `background: ${theme.colors.success};`;
    if ($status === 'failed')  return `background: ${theme.colors.error};`;
    return css`background: ${theme.colors.warning}; animation: ${pulse} 1.6s ease-in-out infinite;`;
  }}
`;

const StyledSubtext = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  color: #666;
  text-align: center;
  line-height: 1.5;
`;

const StyledSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.md};
`;

const StyledLabel = styled.span`
  font-size: ${({ theme }) => theme.typography.sizes.xs};
  font-weight: ${({ theme }) => theme.typography.weights.medium};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #999;
`;

const StyledValue = styled.span`
  font-size: ${({ theme }) => theme.typography.sizes.md};
  color: ${({ theme }) => theme.colors.neutral900};
`;

const StyledDetailsBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.md};
  min-height: 100px;
`;

const StyledDetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: ${({ theme }) => theme.typography.sizes.md};
  color: ${({ theme }) => theme.colors.neutral900};

  span:first-child {
    color: #666;
  }
`;

const StyledBackButton = styled.button`
  width: 100%;
  min-height: 48px;
  background: ${({ theme }) => theme.colors.neutral900};
  color: ${({ theme }) => theme.colors.surface};
  border: none;
  border-radius: ${({ theme }) => theme.radii.md};
  font-family: ${({ theme }) => theme.typography.fontFamily};
  font-size: ${({ theme }) => theme.typography.sizes.md};
  font-weight: ${({ theme }) => theme.typography.weights.medium};
  cursor: pointer;

  &:hover { filter: brightness(1.15); }
`;
