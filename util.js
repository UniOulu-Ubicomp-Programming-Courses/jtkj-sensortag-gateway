module.exports = {
  closestMatch: closestMatch,
  levenshtein: levenshtein
}

function closestMatch(str, suggestions) {
  let bestMatch, bestNum = 100, dist;
  for (const sugg of suggestions) {
    dist = levenshtein(str, sugg);
    if (dist < bestNum) {
      bestNum = dist;
      bestMatch = sugg;
    }
  }
  return bestMatch;
}

function levenshtein(str1, str2) {
  if (str1 == "") return str2.length;
  if (str2 == "") return str1.length;
  let a = str1[0], b = str2[0];
  let sstr1 = str1.substr(1, str1.length);
  let sstr2 = str2.substr(1, str2.length);
  if (a == b) return levenshtein(sstr1, sstr2);
  else return 1 + Math.min(
    levenshtein(str1, sstr2),
    levenshtein(sstr1, str2),
    levenshtein(sstr1, sstr2));
}
