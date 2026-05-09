document.getElementById('test').addEventListener('click', async () => {
  const out = document.getElementById('out');
  out.textContent = 'fetching...';
  try {
    const res = await fetch('http://localhost:9999/test');
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    out.textContent = `ERROR: ${err.message}`;
  }
});
