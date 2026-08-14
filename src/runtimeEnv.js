/**
 * 빌드 시점 환경변수(import.meta.env)와 런타임 주입 환경변수(window.__APP_ENV__)를 함께 읽는다.
 *
 * - 웹(Vercel): 기존과 동일하게 import.meta.env 값을 사용한다.
 * - 데스크톱(Electron): 설치 후 앱 메뉴에서 설정한 값이 window.__APP_ENV__ 로 주입된다.
 */
export function env(key) {
  if (typeof window !== 'undefined' && window.__APP_ENV__ && window.__APP_ENV__[key]) {
    return window.__APP_ENV__[key];
  }
  return import.meta.env?.[key];
}

export const isDesktop =
  typeof window !== 'undefined' && window.__IS_DESKTOP__ === true;
