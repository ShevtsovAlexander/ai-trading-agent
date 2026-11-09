import { useEffect, useId, useState } from "react";
import styled from "styled-components";

interface Props {
  label: string; // что объясняет значок: для чтения с экрана
  children: string;
}

// Значок «?» в круглой рамке с подсказкой (TASK-0015). Своя, а не title:
// системная не открывается клавиатурой. Открывается наведением и фокусом,
// закрывается уходом и Esc
export const InfoHint = ({ label, children }: Props) => {
  const [hidden, setHidden] = useState(false);
  const id = useId();
  // Esc — на документе: под мышью у значка может не быть фокуса
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHidden(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Wrap onMouseEnter={() => setHidden(false)} onMouseLeave={() => setHidden(false)}>
      <Button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onFocus={() => setHidden(false)}
        onBlur={() => setHidden(false)}
      >
        ?
      </Button>
      <Bubble id={id} role="tooltip" $hidden={hidden}>
        {children}
      </Bubble>
    </Wrap>
  );
};

const Wrap = styled.span`
  position: relative;
  display: inline-flex;
`;

const Bubble = styled.span<{ $hidden: boolean }>`
  /* Выше слоёв canvas графика, как скелетон */
  z-index: 4;
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: 280px;
  padding: 8px 10px;
  background: ${({ theme }) => theme.colors.surfaceElevated};
  border: 1px solid ${({ theme }) => theme.colors.hairlineStrong};
  border-radius: ${({ theme }) => theme.radius.sm};
  font-family: ${({ theme }) => theme.font.sans};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 400;
  /* Значок стоит внутри заголовков caption-uppercase (TASK-0016) */
  text-transform: none;
  letter-spacing: normal;
  text-align: left;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.body};
  visibility: hidden;
  pointer-events: none;

  ${Wrap}:hover &,
  button:focus-visible ~ & {
    visibility: ${({ $hidden }) => ($hidden ? "hidden" : "visible")};
  }
`;

const Button = styled.button`
  width: 16px;
  height: 16px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.muted};
  border-radius: 50%;
  font-family: ${({ theme }) => theme.font.sans};
  font-size: ${({ theme }) => theme.fontSize.xs};
  line-height: 1;
  letter-spacing: 0;
  color: ${({ theme }) => theme.colors.muted};
  cursor: help;

  &:hover,
  &:focus-visible {
    border-color: ${({ theme }) => theme.colors.ink};
    color: ${({ theme }) => theme.colors.ink};
    outline: none;
  }
`;
