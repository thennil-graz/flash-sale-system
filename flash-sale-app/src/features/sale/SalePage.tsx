import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { CountdownTimer } from '../../components/CountdownTimer';
import { StockIndicator } from '../../components/StockIndicator';
import { BuyButton } from '../../components/BuyButton';
import { useCountdown } from '../../hooks/useCountdown';
import { useOrderStatus } from '../../hooks/useOrderStatus';
import { placeOrder } from '../../api/order';
import { getProduct } from '../../api/product';
import { Product } from '../../types/product';
import shoeSample from '../../assets/shoe sample-shoes-side.jpg';

const PRODUCT_ID    = 'product_001';
const STOCK_POLL_MS = 5_000;

const FALLBACK_START = new Date(Date.now() + 60 * 1000);
const FALLBACK_END   = new Date(Date.now() + 60 * 60 * 1000);

export function SalePage() {
  const navigate  = useNavigate();
  const userId    = sessionStorage.getItem('userId');
  const userEmail = sessionStorage.getItem('userEmail') ?? '';

  const [product, setProduct]       = useState<Product | null>(null);
  const [loadError, setLoadError]   = useState(false);
  const [saleStart, setSaleStart]   = useState<Date>(FALLBACK_START);
  const [saleEnd, setSaleEnd]       = useState<Date>(FALLBACK_END);
  const [stock, setStock]           = useState(0);

  const [submitting, setSubmitting]   = useState(false);
  const [orderError, setOrderError]   = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { phase, timeLeft }    = useCountdown(saleStart, saleEnd);
  const orderStatus            = useOrderStatus(userId, PRODUCT_ID);
  const purchaseLimitExceeded  = orderStatus === 'success' || orderStatus === 'pending';

  // Load product data and derive sale schedule
  useEffect(() => {
    getProduct(PRODUCT_ID)
      .then((p) => {
        setProduct(p);
        setStock(p.stock);
        if (p.saleStartDate) setSaleStart(new Date(p.saleStartDate));
        if (p.saleEndDate)   setSaleEnd(new Date(p.saleEndDate));
      })
      .catch(() => setLoadError(true));
  }, []);

  // Poll stock every 5 s while the sale is active
  useEffect(() => {
    if (phase !== 'ongoing') return;

    pollRef.current = setInterval(() => {
      getProduct(PRODUCT_ID)
        .then((p) => setStock(p.stock))
        .catch(() => {});
    }, STOCK_POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase]);

  const handleLogout = () => {
    sessionStorage.clear();
    navigate('/login');
  };

  const handleBuy = async () => {
    if (!userId) { navigate('/login'); return; }
    setSubmitting(true);
    setOrderError(false);
    try {
      const order = await placeOrder(userId, PRODUCT_ID);
      navigate('/order', {
        state: {
          orderId:      order.id,
          productTitle: product?.name,
          productPrice: product?.price,
          quantity:     1,
          userId,
          productId:    PRODUCT_ID,
        },
      });
    } catch {
      setOrderError(true);
      setSubmitting(false);
    }
  };

  const effectiveOrderStatus = submitting ? 'pending' : orderStatus;

  if (loadError) {
    return (
      <StyledPage>
        <StyledErrorMessage>Failed to load product. Please refresh.</StyledErrorMessage>
      </StyledPage>
    );
  }

  return (
    <StyledPage>
      <StyledHeader>
        <StyledBrand>Flash Sale</StyledBrand>
        <StyledHeaderRight>
          <StyledUserChip>{userEmail || 'Guest'}</StyledUserChip>
          <StyledLogoutButton onClick={handleLogout}>Logout</StyledLogoutButton>
        </StyledHeaderRight>
      </StyledHeader>

      <StyledSaleBanner>
        <CountdownTimer phase={phase} timeLeft={timeLeft} />
      </StyledSaleBanner>

      {orderError && (
        <StyledResultBanner $type="failed">
          Could not place order. Please try again.
        </StyledResultBanner>
      )}

      <StyledContent>
        <StyledProductLayout>
          <StyledImageBox>
            {product
              ? <img src={shoeSample} alt={product.name} />
              : <StyledImagePlaceholder>Loading…</StyledImagePlaceholder>
            }
          </StyledImageBox>

          <StyledProductInfo>
            <StyledProductTitle>{product?.name ?? '—'}</StyledProductTitle>
            <StyledProductPrice>
              {product ? `$${product.price.toFixed(2)}` : '—'}
            </StyledProductPrice>
            <StyledProductDescription>{product?.description ?? ''}</StyledProductDescription>

            {phase !== 'ended' && (
              <StockIndicator stock={stock} purchaseLimitExceeded={purchaseLimitExceeded} />
            )}

            <BuyButton
              orderStatus={effectiveOrderStatus}
              salePhase={phase}
              stock={stock}
              purchaseLimitExceeded={purchaseLimitExceeded}
              onClick={handleBuy}
            />
          </StyledProductInfo>
        </StyledProductLayout>
      </StyledContent>
    </StyledPage>
  );
}

const StyledPage = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.neutral100};
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const StyledErrorMessage = styled.p`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.error};
  font-size: ${({ theme }) => theme.typography.sizes.md};
`;

const StyledHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  background: ${({ theme }) => theme.colors.surface};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  box-shadow: ${({ theme }) => theme.shadows.card};
`;

const StyledBrand = styled.h1`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.lg};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.primary};
`;

const StyledHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const StyledUserChip = styled.span`
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  color: ${({ theme }) => theme.colors.neutral900};
  background: ${({ theme }) => theme.colors.neutral100};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.full};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
`;

const StyledLogoutButton = styled.button`
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  font-weight: ${({ theme }) => theme.typography.weights.medium};
  color: ${({ theme }) => theme.colors.neutral900};
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  cursor: pointer;

  &:hover { background: ${({ theme }) => theme.colors.neutral100}; }
`;

const StyledSaleBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.lg}`};
  background: ${({ theme }) => theme.colors.surface};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const StyledResultBanner = styled.div<{ $type: 'success' | 'failed' }>`
  padding: ${({ theme }) => theme.spacing.md};
  text-align: center;
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  font-size: ${({ theme }) => theme.typography.sizes.md};
  background: ${({ theme, $type }) =>
    $type === 'success' ? `${theme.colors.success}22` : `${theme.colors.error}22`};
  color: ${({ theme, $type }) =>
    $type === 'success' ? theme.colors.success : theme.colors.error};
  border-bottom: 2px solid ${({ theme, $type }) =>
    $type === 'success' ? theme.colors.success : theme.colors.error};
`;

const StyledContent = styled.main`
  max-width: 900px;
  margin: ${({ theme }) => theme.spacing.xl} auto;
  padding: ${({ theme }) => `0 ${theme.spacing.lg}`};
`;

const StyledProductLayout = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.radii.lg};
  box-shadow: ${({ theme }) => theme.shadows.card};
  padding: ${({ theme }) => theme.spacing.xl};

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const StyledImageBox = styled.div`
  border-radius: ${({ theme }) => theme.radii.md};
  overflow: hidden;
  background: ${({ theme }) => theme.colors.neutral100};
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const StyledImagePlaceholder = styled.span`
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  color: ${({ theme }) => theme.colors.border};
`;

const StyledProductInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const StyledProductTitle = styled.h2`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.xl};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.neutral900};
`;

const StyledProductPrice = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.lg};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.primary};
`;

const StyledProductDescription = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.md};
  color: #666;
  line-height: 1.5;
`;
