import Link from "next/link";
import type { Metadata } from "next";
import { Facts, LEGAL_CONTACT, LegalPage, Section } from "@/components/legal/legal-page";
import { DAILY_LIMITS } from "@/lib/limits";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms of use for lemma: what it does, what it does not promise, and the limits it runs under.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="The deal."
      summary={
        <>
          lemma is a free tool that writes maths practice problems using AI. The
          problems are checked by a second model before you see them, but they can
          still be wrong — so treat it as practice, not as an authority. It is run by
          one person, on free hosting, with no guarantee that it keeps working. Use it
          for your own study, do not attack it, and do not rely on it for anything that
          matters more than a maths exercise.
        </>
      }
    >
      <Section id="what" heading="What lemma is">
        <p>
          lemma generates maths problems to order, verifies them, marks your answers and
          keeps a record of how you did. It is provided free of charge, with no account
          required, and by using it you agree to what follows.
        </p>
      </Section>

      <Section id="accuracy" heading="AI-generated maths can be wrong">
        <p>
          This is the most important thing on this page, so it is not buried in a
          disclaimer at the bottom.
        </p>
        <p>
          Every problem is written by a language model, then solved again from the
          statement alone by a second model that never sees the intended answer. A
          problem is only served if the two agree, or if a single repair attempt makes
          them agree; otherwise it is discarded. Some problems come from deterministic
          templates instead, where the answer is computed rather than claimed. This
          catches a great deal.
        </p>
        <p>
          It does not catch everything. A stored answer can still be wrong, an
          explanation can contain a false step, and a correct answer of yours can
          occasionally be marked wrong — particularly when it is written in an unusual
          but equivalent form. lemma is a way to get practice, not a source of truth. If
          it disagrees with your teacher or your textbook, they are right.
        </p>
        <p>
          Nothing here is a substitute for teaching, and none of it is checked by a
          person before you see it.
        </p>
      </Section>

      <Section id="age" heading="Who can use it">
        <p>
          You must be at least 13 years old — at least 16 in the European Economic Area
          and the United Kingdom. If you are under the age of majority where you live,
          you should have a parent or guardian&apos;s permission to use it.
        </p>
      </Section>

      <Section id="acceptable" heading="Acceptable use">
        <p>You agree not to:</p>
        <Facts
          items={[
            {
              term: "Attack or overload the service",
              detail:
                "No automated bulk requests, no attempts to bypass the daily limits by creating accounts in a loop, no probing for other people's data, and no interfering with anyone else's use of it.",
            },
            {
              term: "Try to reach answer keys you have not earned",
              detail:
                "Answers are released only for problems in sets you own, and only once an attempt is on record. Working around that is a breach of these terms, and it mostly cheats you rather than anyone else.",
            },
            {
              term: "Upload other people's material",
              detail:
                "Only photograph work you are entitled to upload. Do not upload anything containing another person's details, or anything unlawful.",
            },
            {
              term: "Use it to generate anything other than maths practice",
              detail:
                "The prompts and problem formats are for study. Do not attempt to use the model access behind them for anything else.",
            },
          ]}
        />
      </Section>

      <Section id="limits" heading="Limits">
        <p>
          lemma runs on a free model quota shared by everyone using it, so there are
          daily bounds per account. They exist to keep one person from exhausting the
          service for everyone else, not to push you toward a paid tier — there is no
          paid tier.
        </p>
        <Facts
          items={[
            {
              term: "Generated sets",
              detail: `${DAILY_LIMITS.generatedSets.guest} a day as a guest, ${DAILY_LIMITS.generatedSets.member} signed in. Only sets that actually cost a model call count.`,
            },
            {
              term: "Worksheet scans",
              detail: `${DAILY_LIMITS.scans.guest} a day as a guest, ${DAILY_LIMITS.scans.member} signed in.`,
            },
            {
              term: "Review sets and copies of shared sets",
              detail: `${DAILY_LIMITS.reviewSets.member} and ${DAILY_LIMITS.sharedCopies.member} a day. These are assembled from problems that already exist, so they are bounded separately.`,
            },
            {
              term: "Marking",
              detail:
                "Beyond a generous daily amount of model-assisted marking, your answers are still graded, but the written explanation of a wrong answer is withheld until the next day.",
            },
          ]}
        />
        <p>
          These numbers may change as the service&apos;s costs do.
        </p>
      </Section>

      <Section id="your-content" heading="Your work stays yours">
        <p>
          The answers you write and the worksheets you upload remain yours. lemma claims
          no ownership of them and uses them only to run the service for you — marking
          your work, keeping your record, and showing you your statistics. See the{" "}
          <Link href="/privacy" className="link">
            privacy policy
          </Link>{" "}
          for exactly where they go.
        </p>
        <p>
          Generated problems and explanations are produced by a model on request. No
          claim of ownership is made over them, and you are free to use them for your
          own study or teaching.
        </p>
      </Section>

      <Section id="availability" heading="No guarantee of availability">
        <p>
          lemma is provided as-is and as-available, with no warranty of any kind. It may
          be slow, it may be unavailable, features may change, and it may stop
          altogether without notice. Free model capacity fluctuates, and a set that
          builds today may fail to build tomorrow.
        </p>
        <p>
          Please keep your own copy of anything you cannot afford to lose. Deleting your
          data is immediate and permanent, and there are no backups to restore you from.
        </p>
      </Section>

      <Section id="liability" heading="Liability">
        <p>
          To the fullest extent the law allows, lemma and its operator are not liable for
          any loss arising from your use of it — including lost work, lost time, a mark
          you disagree with, or a wrong answer you relied on. Your remedy if lemma is not
          useful to you is to stop using it.
        </p>
        <p>
          Nothing here limits liability that cannot legally be limited.
        </p>
      </Section>

      <Section id="ending" heading="Ending it">
        <p>
          You can stop at any time, and delete everything from{" "}
          <Link href="/account" className="link">
            your account page
          </Link>
          . Access may be withdrawn from anyone breaching the acceptable-use section
          above, particularly where it degrades the service for others.
        </p>
      </Section>

      <Section id="changes" heading="Changes">
        <p>
          These terms may change; the date at the top says when they last did.
          Continuing to use lemma after a change means accepting the revised terms. If
          you disagree with a change, delete your data and stop using it — and if
          something here seems unfair, say so at{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
