import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { login } from '../../api/auth';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email);
      sessionStorage.setItem('userId', result.userId);
      sessionStorage.setItem('userEmail', result.email);
      navigate('/');
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <StyledPage>
      <StyledCard>
        <StyledForm onSubmit={handleSubmit}>
          <StyledInput
            type="email"
            placeholder="Enter email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          {error && <StyledError>{error}</StyledError>}
          <StyledLoginButton type="submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Login'}
          </StyledLoginButton>
        </StyledForm>
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
`;

const StyledCard = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.radii.lg};
  box-shadow: ${({ theme }) => theme.shadows.elevated};
  padding: ${({ theme }) => theme.spacing.xl};
  width: 100%;
  max-width: 380px;
`;

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const StyledInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radii.md};
  font-family: ${({ theme }) => theme.typography.fontFamily};
  font-size: ${({ theme }) => theme.typography.sizes.md};
  color: ${({ theme }) => theme.colors.neutral900};
  background: ${({ theme }) => theme.colors.surface};
  outline: none;

  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const StyledError = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.sizes.sm};
  color: ${({ theme }) => theme.colors.error};
`;

const StyledLoginButton = styled.button`
  width: 100%;
  min-height: 48px;
  background: ${({ theme }) => theme.colors.neutral900};
  color: ${({ theme }) => theme.colors.surface};
  border: none;
  border-radius: ${({ theme }) => theme.radii.md};
  font-family: ${({ theme }) => theme.typography.fontFamily};
  font-size: ${({ theme }) => theme.typography.sizes.md};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
  cursor: pointer;

  &:disabled {
    background: ${({ theme }) => theme.colors.border};
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    filter: brightness(1.15);
  }
`;
