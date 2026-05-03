import styled from 'styled-components';
import { SalePhase } from '../types/sale';

interface Props {
  phase: SalePhase;
  timeLeft: { days: number; hours: number; minutes: number; seconds: number };
}

const pad = (n: number) => String(n).padStart(2, '0');

function Segments({ days, hours, minutes, seconds }: Props['timeLeft']) {
  return (
    <StyledSegments>
      {days > 0 && (
        <>
          <StyledSegment>
            <StyledDigits>{pad(days)}</StyledDigits>
            <StyledUnit>d</StyledUnit>
          </StyledSegment>
          <StyledSep>:</StyledSep>
        </>
      )}
      <StyledSegment>
        <StyledDigits>{pad(hours)}</StyledDigits>
        <StyledUnit>h</StyledUnit>
      </StyledSegment>
      <StyledSep>:</StyledSep>
      <StyledSegment>
        <StyledDigits>{pad(minutes)}</StyledDigits>
        <StyledUnit>m</StyledUnit>
      </StyledSegment>
      <StyledSep>:</StyledSep>
      <StyledSegment>
        <StyledDigits>{pad(seconds)}</StyledDigits>
        <StyledUnit>s</StyledUnit>
      </StyledSegment>
    </StyledSegments>
  );
}

export function CountdownTimer({ phase, timeLeft }: Props) {
  return (
    <StyledWrapper>
      {phase === 'upcoming' && (
        <>
          <StyledLabel>Starts in</StyledLabel>
          <Segments {...timeLeft} />
        </>
      )}
      {phase === 'ongoing' && (
        <>
          <StyledLabel>Ends in</StyledLabel>
          <Segments {...timeLeft} />
        </>
      )}
      {phase === 'ended' && <StyledLabel $ended>Sale Ended</StyledLabel>}
    </StyledWrapper>
  );
}

const StyledWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const StyledLabel = styled.span<{ $ended?: boolean }>`
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  font-weight: ${({ theme }) => theme.typography.weights.medium};
  color: ${({ theme, $ended }) => ($ended ? theme.colors.error : theme.colors.neutral900)};
`;

const StyledSegments = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`;

const StyledSegment = styled.div`
  display: flex;
  align-items: baseline;
  gap: 1px;
`;

const StyledDigits = styled.span`
  font-family: 'Courier New', monospace;
  font-size: ${({ theme }) => theme.typography.sizes.md};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 0.05em;
`;

const StyledUnit = styled.span`
  font-size: ${({ theme }) => theme.typography.sizes.xs};
  font-weight: ${({ theme }) => theme.typography.weights.medium};
  color: ${({ theme }) => theme.colors.neutral900};
`;

const StyledSep = styled.span`
  font-family: 'Courier New', monospace;
  font-size: ${({ theme }) => theme.typography.sizes.md};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  color: ${({ theme }) => theme.colors.neutral900};
  opacity: 0.4;
  margin: 0 1px;
`;
