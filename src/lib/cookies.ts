// Egyszerű cookie-kezelés (funkcionális beállításokhoz: név, téma, URL-ek).

export function setCookie(name: string, value: string, days = 365) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function deleteCookie(name: string) {
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
}
