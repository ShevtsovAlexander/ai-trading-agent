import { createGlobalStyle } from 'styled-components';

export const GlobalStyles = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    background: ${({ theme }) => theme.colors.canvas};
    color: ${({ theme }) => theme.colors.body};
    font-family: ${({ theme }) => theme.font.sans};
    /* Цифры одной ширины — столбцы цен и индикаторов не пляшут */
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
  }

  button {
    cursor: pointer;
    font-family: inherit;
  }
`;
