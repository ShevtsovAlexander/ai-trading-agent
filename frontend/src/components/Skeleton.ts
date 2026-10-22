import styled, { keyframes } from "styled-components";

// Пульсация прозрачности — без градиента и тени (DESIGN.md «Elevation»)
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`;

// Плашка скелетона загрузки (TASK-0005): форма блока, пока данные в пути
export const Skeleton = styled.div<{ $w?: string; $h?: string }>`
  width: ${({ $w }) => $w ?? "100%"};
  height: ${({ $h }) => $h ?? "12px"};
  border-radius: ${({ theme }) => theme.radius.xs};
  background: ${({ theme }) => theme.colors.surfaceElevated};
  animation: ${pulse} 1.4s ease-in-out infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
