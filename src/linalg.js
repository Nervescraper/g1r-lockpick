// Exact-integer matrix helpers for the solver. Inputs are small square integer
// matrices (n <= 8, entries are coupling values), so all intermediate values stay
// within JS safe integers and no floating point is involved.

// Transpose any (possibly rectangular) matrix.
export function transpose(M) {
  const rows = M.length;
  const cols = M[0].length;
  const out = Array.from({ length: cols }, () => Array(rows));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[j][i] = M[i][j];
  }
  return out;
}

// Matrix times column vector.
export function matVec(M, v) {
  return M.map((row) => row.reduce((s, m, j) => s + m * v[j], 0));
}

// Integer determinant via the Bareiss (fraction-free) algorithm. Every division is
// exact, so the result is an exact integer. Returns 0 for a singular matrix.
// Does not mutate the input.
export function det(A) {
  const n = A.length;
  const M = A.map((r) => r.slice());
  let sign = 1;
  let prev = 1;
  for (let k = 0; k < n - 1; k++) {
    if (M[k][k] === 0) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) {
        if (M[i][k] !== 0) { swap = i; break; }
      }
      if (swap === -1) return 0; // singular
      [M[k], M[swap]] = [M[swap], M[k]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        M[i][j] = (M[i][j] * M[k][k] - M[i][k] * M[k][j]) / prev;
      }
      M[i][k] = 0;
    }
    prev = M[k][k];
  }
  return sign * M[n - 1][n - 1];
}

// The minor of A with `row` and `col` removed.
function minor(A, row, col) {
  const out = [];
  for (let i = 0; i < A.length; i++) {
    if (i === row) continue;
    const r = [];
    for (let j = 0; j < A.length; j++) {
      if (j === col) continue;
      r.push(A[i][j]);
    }
    out.push(r);
  }
  return out;
}

// Classical adjoint (adjugate): the transpose of the cofactor matrix, so that
// A * adjugate(A) = det(A) * I. Exact integers. n >= 1.
export function adjugate(A) {
  const n = A.length;
  if (n === 1) return [[1]];
  const adj = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cofactor = ((i + j) % 2 === 0 ? 1 : -1) * det(minor(A, i, j));
      adj[j][i] = cofactor || 0; // transpose: cofactor of (i,j) goes to adj[j][i]; || 0 converts -0 to 0
    }
  }
  return adj;
}
