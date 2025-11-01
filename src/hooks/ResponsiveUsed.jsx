import { useMediaQuery } from 'react-responsive';

export const useResponsive = () => {
  const isMobile = useMediaQuery({ maxWidth: 479 });
  const isTablet = useMediaQuery({ minWidth: 480, maxWidth: 1023 });
  const isDesktop = useMediaQuery({ minWidth: 1024 });

  return { isMobile, isTablet, isDesktop };
};
