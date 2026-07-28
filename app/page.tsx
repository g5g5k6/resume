import { getDefaultResume, loadResumeData } from "@/lib/data";
import ResumeView from "./ResumeView";
import KeywordsBox from "./KeywordsBox";
import styles from "./page.module.css";

export default function Home() {
  const data = loadResumeData();
  const positions = getDefaultResume(data);

  return (
    <main className={styles.page}>
      <KeywordsBox />
      <p className={styles.defaultNote}>Showing the default resume — tailor it with keywords above.</p>
      <ResumeView owner={data.owner} positions={positions} />
    </main>
  );
}
