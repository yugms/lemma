import Link from "next/link";
import type { Metadata } from "next";
import { Facts, LEGAL_CONTACT, LegalPage, Section } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What lemma stores, who it is sent to, how long it is kept, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="What lemma knows about you."
      summary={
        <>
          You can use lemma without an account, and without giving a name or an email.
          What is stored is the practice itself — the problems you were given and how
          you answered them — so that scores, stats and the review queue can be worked
          out from it. Problems and answers are sent to Google&apos;s Gemini models to
          be written, checked and marked. Nothing is sold, and there is no advertising
          or third-party tracking of any kind. You can delete all of it at any time
          from{" "}
          <Link href="/account" className="link">
            your account page
          </Link>
          .
        </>
      }
    >
      <Section id="collected" heading="What is stored">
        <Facts
          items={[
            {
              term: "If you use lemma as a guest",
              detail:
                "An anonymous account with a random id, and nothing else identifying you. There is no name and no email address. The id lives in a cookie in your browser — which is also why clearing your cookies orphans that work permanently, with no way to recover it from another device.",
            },
            {
              term: "If you sign in with Google",
              detail:
                "Your name and email address, as supplied by Google, plus the fact that the account is linked to that Google identity. lemma never sees or stores your Google password. If you were working as a guest first, the existing account is upgraded in place, so the practice you already have is kept.",
            },
            {
              term: "Your practice",
              detail:
                "The sets you generate and their settings; every answer you submit, whether it was right, how long you took, and which mode you were in; study sessions you start and stop; and a cached summary of your statistics used to suggest what to work on next.",
            },
            {
              term: "Worksheets you photograph",
              detail:
                "The image files themselves, along with what the model read from them and the marks it gave. Covered in its own section below, because it is the most sensitive thing here.",
            },
            {
              term: "Ordinary server logs",
              detail:
                "The hosting provider records requests, including IP addresses, as part of running the service. These are not linked to your practice record and are not used to build any profile of you.",
            },
          ]}
        />
      </Section>

      <Section id="scans" heading="Photographs of your work">
        <p>
          Scanning is the one feature that uploads something you did not type, and a
          photo of a worksheet often carries more than the maths: a name at the top of
          the page, a school header, a date, sometimes another student&apos;s
          handwriting. It is worth knowing exactly what happens to it.
        </p>
        <p>
          The image goes from your device into a private storage bucket, filed under
          your account id. It is not public, it is not indexed, and no URL to it is
          shareable. It is then sent to Google&apos;s Gemini model, which transcribes
          the handwriting and judges the maths; the transcription and the marks are
          stored against your account so the results survive a page reload.
        </p>
        <p>
          Two practical consequences. Photograph only the work — cropping out a name
          costs you nothing and means it is never uploaded at all. And if you delete
          your data, the image files are removed from storage as well as the database
          records, in that order, deliberately: doing it the other way round would
          leave files behind that nothing points at any more.
        </p>
      </Section>

      <Section id="ai" heading="What is sent to Google">
        <p>
          lemma uses Google&apos;s Gemini models through Google AI Studio for four
          things: writing problems, independently re-solving them to check the answer,
          judging whether an answer you typed means the same as the stored one, and
          reading photographed worksheets.
        </p>
        <p>
          That means the following leaves lemma and reaches Google: the topic and
          settings you asked for, the text of problems, answers you submit when local
          comparison cannot settle them, and any worksheet image you upload. Your name,
          your email address and your account id are <em>not</em> sent — the model is
          given the maths, not the student.
        </p>
        <p>
          Google&apos;s handling of that data is governed by its own terms, not by this
          policy. Note in particular that content sent through the free tier of Google
          AI Studio may be reviewed by Google and used to improve its models. If that
          matters to you, the practical advice is not to photograph pages carrying
          personal details, and not to type anything into an answer box you would not
          want read.
        </p>
      </Section>

      <Section id="processors" heading="Who else handles it">
        <Facts
          items={[
            {
              term: "Supabase",
              detail:
                "The database, the sign-in system and the file storage. Data is held on servers in the United States (region us-east-1).",
            },
            {
              term: "Vercel",
              detail: "Hosting and server logs for the site itself.",
            },
            {
              term: "Google",
              detail:
                "The Gemini models described above, and — only if you choose it — Google sign-in.",
            },
            {
              term: "Cloudflare",
              detail:
                "An anti-abuse check (Turnstile) that runs once, at the moment your guest session is first created, and never again. It exists because anyone can create guest accounts here without an email address, and without it a script could create them in bulk and exhaust the shared model quota for everyone. Cloudflare sees your IP address and some technical signals from your browser for that check. It does not track you across sites and is not used for advertising.",
            },
          ]}
        />
        <p>
          That is the complete list. There is no analytics provider, no advertising
          network, no session recording, and no data broker. Nothing about you is sold
          or shared for marketing.
        </p>
      </Section>

      <Section id="cookies" heading="Cookies">
        <p>
          lemma sets one kind of cookie: the session cookie that keeps you signed in,
          including as a guest. It is strictly necessary — without it the site cannot
          tell which sets are yours — so there is no consent banner to click, because
          there is nothing optional to consent to.
        </p>
        <p>
          Your light or dark theme preference is kept in your browser&apos;s local
          storage rather than a cookie, and is never sent to the server.
        </p>
        <p>
          The one exception is Cloudflare&apos;s anti-abuse check described above, which
          may set a short-lived cookie of its own while it runs. That happens once, when
          a guest session is first created, and it is not something lemma reads.
        </p>
      </Section>

      <Section id="retention" heading="How long it is kept, and how to delete it">
        <p>
          Practice data is kept until you remove it, because that is the point of it:
          your stats and review queue are recalculated from your history every time,
          and there is no separate score to fall back on if the history goes.
        </p>
        <p>
          <Link href="/account" className="link">
            Your account page
          </Link>{" "}
          offers three levels, and they are genuinely different:
        </p>
        <Facts
          items={[
            {
              term: "Clear practice history",
              detail:
                "Removes every answer, study session, cached suggestion and uploaded scan. Keeps the sets themselves, so you can work through them again from scratch.",
            },
            {
              term: "Delete all my data",
              detail: "The above, plus the sets. The account itself survives.",
            },
            {
              term: "Delete my account",
              detail:
                "Removes the account and everything attached to it, and signs you out. Stored files are swept from the bucket first, then the database records are cascaded away.",
            },
          ]}
        />
        <p>
          All three are immediate and permanent — there is no recovery window and no
          backup we can restore you from. If you would rather ask than click, write to{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </Section>

      <Section id="rights" heading="Your rights">
        <p>
          Depending on where you live you may have rights to see, correct, export or
          erase the personal data an organisation holds about you — the UK and EU
          (GDPR), California (CCPA/CPRA) and several other places all grant versions of
          this. lemma&apos;s answer is the same either way: the deletion controls above
          are available to everyone, immediately, without having to ask.
        </p>
        <p>
          For a copy of what is held, or anything the account page does not cover, email{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>
          . lemma is run by one person, so please allow a little time for a reply.
        </p>
      </Section>

      <Section id="age" heading="Age">
        <p>
          lemma is for students aged 13 and over — 16 and over in the European
          Economic Area and the United Kingdom, where that is the threshold for
          consenting to this kind of processing on your own.
        </p>
        <p>
          It is not directed at children under those ages and does not knowingly collect
          anything from them. If you are a parent or guardian and believe a child has
          used lemma, email{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>{" "}
          and the account and everything on it will be deleted.
        </p>
      </Section>

      <Section id="security" heading="Security">
        <p>
          Every table holding your work is protected by row-level security, so one
          account cannot read another&apos;s. Worksheet images sit in a private bucket
          keyed to your account id. Answer keys are held in a table the browser has no
          read access to at all — they are released only through a server route that
          first proves the problem belongs to a set you own.
        </p>
        <p>
          No system is perfect, and this one is run by an individual rather than a
          company with a security team. Please do not put anything into lemma that you
          would be seriously harmed by losing or exposing.
        </p>
      </Section>

      <Section id="changes" heading="Changes to this policy">
        <p>
          If this policy changes materially, the date at the top changes with it. There
          is no mailing list to notify, so the date is the signal — it is edited by
          hand, and never set to today automatically, precisely so that it means
          something.
        </p>
      </Section>
    </LegalPage>
  );
}
