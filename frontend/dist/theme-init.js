// Ustawia motyw przed wyrenderowaniem aplikacji - bez błysku jasnego tła w trybie ciemnym.
// Osobny plik (a nie skrypt inline), bo polityka CSP dopuszcza tylko skrypty z własnej domeny.
(function () {
  try {
    var saved = localStorage.getItem('silownik-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) { /* brak dostępu do pamięci - motyw ustawi aplikacja */ }
})();
