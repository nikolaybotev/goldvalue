import { BIS_ATTRIBUTION, LBMA_ATTRIBUTION, LINKS, MONTHLY_ATTRIBUTION } from "../lib/attribution";

export function Footer() {
  return (
    <footer class="site-footer">
      <p>{LBMA_ATTRIBUTION}</p>
      <p>{MONTHLY_ATTRIBUTION}</p>
      <p>{BIS_ATTRIBUTION}</p>
      <p>
        MIT licensed. <a href={LINKS.repo}>Source on GitHub</a>. Gold-denominated, not CPI.
      </p>
    </footer>
  );
}
