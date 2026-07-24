try {
  var theme = localStorage.getItem('ui-theme') === 'light' ? 'light' : 'blast';
  var stylesheets = Array.prototype.slice.call(
    document.querySelectorAll('link[data-blast-theme]')
  );
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'blast' ? 'dark' : 'light';
  document.documentElement.style.background = theme === 'blast' ? '#160a13' : '#f3f0ea';
  stylesheets.forEach(function (stylesheet) {
    if (theme === 'blast') {
      stylesheet.media = 'all';
      document.head.appendChild(stylesheet);
    } else {
      stylesheet.media = 'not all';
    }
  });
  document.querySelector('meta[name="theme-color"]').content =
    theme === 'blast' ? '#160a13' : '#f3f0ea';

  if (theme === 'light') {
    document.documentElement.dataset.themeReady = '';
  } else {
    var pending = stylesheets.filter(function (stylesheet) {
      return !stylesheet.sheet;
    });
    if (!pending.length) {
      document.documentElement.dataset.themeReady = '';
    } else {
      var remaining = pending.length;
      var reveal = function () {
        remaining -= 1;
        if (remaining <= 0) document.documentElement.dataset.themeReady = '';
      };
      pending.forEach(function (stylesheet) {
        stylesheet.addEventListener('load', reveal, { once: true });
        stylesheet.addEventListener('error', reveal, { once: true });
      });
      setTimeout(function () {
        document.documentElement.dataset.themeReady = '';
      }, 3000);
    }
  }
} catch (_) {
  document.documentElement.dataset.theme = 'blast';
  document.documentElement.style.background = '#160a13';
  document.documentElement.dataset.themeReady = '';
}
