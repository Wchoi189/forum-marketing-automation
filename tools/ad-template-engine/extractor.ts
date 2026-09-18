import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

export interface AdCard {
  title: string;
  badge?: string;
  duration?: string;
  originalPrice?: string;
  price: string;
  priceDesc: string;
  style: 'normal' | 'best' | 'pro';
}

export interface AdSubsection {
  label?: string;
  desc?: string;
  cards: AdCard[];
}

export interface AdNotice {
  type: 'details' | 'box';
  title: string;
  content: string;
}

export interface AdSection {
  id: string;
  title: string;
  subsections: AdSubsection[];
  notices: AdNotice[];
}

export interface ExtraItem {
  name: string;
  duration: string;
  price: string;
}

export interface AdData {
  schemaVersion: string;
  header: {
    logoSrc: string;
    logoAlt: string;
    title: string;
    subtitle: string;
  };
  navLinks: Array<{ id: string; label: string }>;
  sections: AdSection[];
  extraSection: {
    id: string;
    title: string;
    items: ExtraItem[];
    deliveryNote: string;
  };
  footer: {
    termsNotice: string;
    kakaoLink: string;
    phone: string;
    bankAccount: string;
    bankDetails: string;
    copyright: string;
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractAdFields(htmlContent: string): AdData {
  // 1. Nav Links
  const navLinks: Array<{ id: string; label: string }> = [];
  const navMatch = htmlContent.match(/섹션이동:<\/span>([\s\S]*?)<\/div>/);
  if (navMatch) {
    const linkRegex = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = linkRegex.exec(navMatch[1])) !== null) {
      navLinks.push({
        id: match[1].trim(),
        label: stripHtml(match[2]),
      });
    }
  }

  // 2. Header
  const logoMatch = htmlContent.match(/<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/);
  const logoSrc = logoMatch ? logoMatch[1] : '';
  const logoAlt = logoMatch ? logoMatch[2] : '';

  const titleMatch = htmlContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const headerTitle = titleMatch ? stripHtml(titleMatch[1]) : '';

  const subtitleMatch = htmlContent.match(/<h2[\s\S]*?<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/);
  const headerSubtitle = subtitleMatch ? stripHtml(subtitleMatch[1]) : '';

  // 3. Sections
  const sections: AdSection[] = [];
  const sectionIds = [
    'section-youtube',
    'google-ai',
    'picsart',
    'section-adobe',
    'section-lovable',
    'section-notion',
    'section-n8n',
    'section-surfshark',
    'section-coursera',
  ];

  for (let i = 0; i < sectionIds.length; i++) {
    const sId = sectionIds[i];
    const nextId = i < sectionIds.length - 1 ? sectionIds[i + 1] : 'section-extra';
    const sectionRegex = new RegExp(`<div\\s+id="${sId}"[\\s\\S]*?(?=<div\\s+id="${nextId}")`);
    const sMatch = htmlContent.match(sectionRegex);
    if (!sMatch) continue;

    const sHtml = sMatch[0];

    // Section title
    const h3Match = sHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const sTitle = h3Match ? stripHtml(h3Match[1]) : '';

    // Subsections or Cards
    const subsections: AdSubsection[] = [];

    // Check for explicit subsections (e.g. YouTube 개인 단독 / 가족 플랜)
    const subLabelMatches = Array.from(sHtml.matchAll(/<span[^>]*style="[^"]*border-radius:\s*999px;[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/g));

    if (subLabelMatches.length > 0) {
      for (const sm of subLabelMatches) {
        const label = stripHtml(sm[1]);
        const desc = stripHtml(sm[2]);
        // Find grid following this subsection
        const subIndex = sHtml.indexOf(sm[0]);
        const gridMatch = sHtml.substring(subIndex).match(/<div\s+style="display:\s*grid;[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
        const cards = gridMatch ? parseCards(gridMatch[0]) : [];
        subsections.push({ label, desc, cards });
      }
    } else {
      // Single grid without explicit subsection labels
      const gridMatch = sHtml.match(/<div\s+style="display:\s*grid;[\s\S]*?(?=<div\s+style="display:\s*flex;\s*flex-direction:\s*column;\s*gap:\s*10px;|<\/div>\s*$)/);
      const cards = gridMatch ? parseCards(gridMatch[0]) : [];
      subsections.push({ cards });
    }

    // Notices
    const notices: AdNotice[] = [];
    const descMatch = sHtml.match(/<!-- Descriptions Section -->([\s\S]*?)$/);
    const descHtml = descMatch ? descMatch[1] : sHtml;
    const noticeBlocks = descHtml.split(/(?=<details|<div\s+style="padding:\s*12px\s*16px;)/)
      .filter(b => b.includes('padding: 12px 16px') || b.includes('<details'));

    for (const block of noticeBlocks) {
      if (block.includes('<details')) {
        const sumMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
        const nTitle = sumMatch ? stripHtml(sumMatch[1]) : '';
        const bodyMatch = block.match(/<summary[^>]*>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/);
        const body = bodyMatch ? bodyMatch[1] : block;
        const cleanContent = stripHtml(body)
          .replace(/•\s*/g, '\n• ')
          .replace(/📢/g, '\n📢 ')
          .replace(/1️⃣/g, '\n1️⃣ ')
          .replace(/2️⃣/g, '\n2️⃣ ')
          .replace(/💡/g, '\n💡 ')
          .trim();

        notices.push({
          type: 'details',
          title: nTitle,
          content: cleanContent,
        });
      } else {
        const strongMatch = block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/);
        const bTitle = strongMatch ? stripHtml(strongMatch[1]) : '';
        const bodyIndex = strongMatch ? block.indexOf(strongMatch[0]) + strongMatch[0].length : 0;
        const bodyHtml = block.substring(bodyIndex);

        const lines = Array.from(bodyHtml.matchAll(/<(?:div|p)[^>]*>([\s\S]*?)<\/(?:div|p)>/g))
          .map(m => stripHtml(m[1]))
          .filter(l => l.length > 0 && !l.includes('Descriptions Section'));

        const content = lines.length > 0 ? lines.join('\n') : stripHtml(bodyHtml);

        notices.push({
          type: 'box',
          title: bTitle,
          content,
        });
      }
    }

    sections.push({
      id: sId,
      title: sTitle,
      subsections,
      notices,
    });
  }

  // 4. Extra Section
  const extraMatch = htmlContent.match(/<div\s+id="section-extra"[\s\S]*?(?=<div\s+id="section-start"|<div\s+style="font-family:[^"]*border-width:\s*1px\s*1px\s*1px\s*4px)/);
  const extraHtml = extraMatch ? extraMatch[0] : '';
  const extraH3 = extraHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
  const extraTitle = extraH3 ? stripHtml(extraH3[1]) : '추가 소프트웨어 특가';

  const extraItems: ExtraItem[] = [];
  const itemMatches = Array.from(extraHtml.matchAll(/<div style="flex:\s*2;[^"]*">([\s\S]*?)<\/div>\s*<div style="flex:\s*1;\s*text-align:\s*center;[^"]*">([\s\S]*?)<\/div>\s*<div style="flex:\s*1;\s*text-align:\s*right;[^"]*">([\s\S]*?)<\/div>/g));
  for (const im of itemMatches) {
    const name = stripHtml(im[1]);
    if (name !== '상품명') {
      extraItems.push({
        name,
        duration: stripHtml(im[2]),
        price: stripHtml(im[3]),
      });
    }
  }

  const deliveryMatch = extraHtml.match(/⏱️[\s\S]*?※([\s\S]*?)<\/div>/);
  const deliveryNote = deliveryMatch ? '※ ' + stripHtml(deliveryMatch[1]) : '※ 발급 및 세팅 소요 시간: 24시간 이내 (Delivery time is 24 hours)';

  // 5. Footer
  const termsMatch = htmlContent.match(/<div\s+style="font-size:\s*11\.5px;[^"]*">([\s\S]*?)<\/div>/);
  const termsNotice = termsMatch ? stripHtml(termsMatch[1]) : '-서비스 보장: 자동 취소 등 문제가 발생해도 재설정·대체 제공·환불 등 가능한 방법을 안내드리며, 최대한불이익이없도록 처리합니다.';

  const kakaoMatch = htmlContent.match(/href="(https:\/\/pf\.kakao\.com\/[^"]+)"/);
  const kakaoLink = kakaoMatch ? kakaoMatch[1] : 'https://pf.kakao.com/_xnCFRn/chat';

  const phoneMatch = htmlContent.match(/담당자\s*연락처<\/div>\s*<div[^>]*>([\d-]+)<\/div>/);
  const phone = phoneMatch ? stripHtml(phoneMatch[1]) : '010-2364-8676';

  const bankAccMatch = htmlContent.match(/입금\s*계좌<\/div>\s*<div[^>]*>([\d-]+)<\/div>/);
  const bankAccount = bankAccMatch ? stripHtml(bankAccMatch[1]) : '108-179305-04-017';

  const bankDetailsMatch = htmlContent.match(/은행명:[\s\S]*?예금주:[\s\S]*?(?=<\/div>)/);
  const bankDetails = bankDetailsMatch ? stripHtml(bankDetailsMatch[0]).replace(/예금주:/, '\n예금주:') : '은행명: IBK기업은행\n예금주: 최웅비 쉐어플랜(shareplan)';

  const copyrightMatch = htmlContent.match(/©[\s\S]*?SharePlan[\s\S]*?모든\s*권리\s*보유\./);
  const copyright = copyrightMatch ? stripHtml(copyrightMatch[0]) : '© 2024-2026 SharePlan. 모든 권리 보유.';

  return {
    schemaVersion: 'ad-1.0',
    header: {
      logoSrc,
      logoAlt,
      title: headerTitle,
      subtitle: headerSubtitle,
    },
    navLinks,
    sections,
    extraSection: {
      id: 'section-extra',
      title: extraTitle,
      items: extraItems,
      deliveryNote,
    },
    footer: {
      termsNotice,
      kakaoLink,
      phone,
      bankAccount,
      bankDetails,
      copyright,
    },
  };
}

function parseCards(gridHtml: string): AdCard[] {
  const cards: AdCard[] = [];
  // Split each card container inside grid
  const cardDivs = gridHtml.split(/(?=<div\s+style="[^"]*border(?:-radius)?:\s*(?:16px|1px|2px)[^"]*overflow:\s*hidden[^"]*")/g);

  for (const cHtml of cardDivs) {
    if (!cHtml.includes('border-radius: 16px') && !cHtml.includes('border-radius:16px')) continue;

    // Determine style
    let style: 'normal' | 'best' | 'pro' = 'normal';
    if (cHtml.includes('200,122,83') || cHtml.includes('#C87A53') || cHtml.includes('#DDA78A')) {
      style = 'pro';
    } else if (cHtml.includes('border: 2px solid #1E1E1E') || cHtml.includes('border: 2px solid rgb(92, 90, 86)')) {
      style = 'best';
    } else {
      style = 'normal';
    }

    // Top bar: div containing justify-content: space-between
    const topBarMatch = cHtml.match(/<div\s+style="[^"]*justify-content:\s*space-between[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    let cardTitle = '';
    let badge: string | undefined;

    if (topBarMatch) {
      const topBarHtml = topBarMatch[1];
      const spans = Array.from(topBarHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)).map(s => stripHtml(s[1]));
      if (spans.length >= 1) {
        cardTitle = spans[0];
      }
      if (spans.length >= 2 && (spans[1].length <= 10 || spans[1].includes('절감') || spans[1].includes('보장') || spans[1].includes('추천') || spans[1].includes('인기') || spans[1].includes('BEST') || spans[1].includes('체험형') || spans[1].includes('실속형'))) {
        badge = spans[1];
      }
    }

    // Body:
    const bodyMatch = cHtml.match(/<div\s+style="padding:\s*(?:16px|20px)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
    const bodyHtml = bodyMatch ? bodyMatch[1] : cHtml;

    // Duration
    const durationMatch = bodyHtml.match(/<div[^>]*font-weight:\s*700;[^>]*color:\s*(?:#5C5A56|rgb\(92, 90, 86\));[^>]*>([\s\S]*?)<\/div>/);
    const duration = durationMatch ? stripHtml(durationMatch[1]) : undefined;

    // Original Price (line-through)
    const origMatch = bodyHtml.match(/<div[^>]*line-through[^>]*>([\s\S]*?)<\/div>/);
    const originalPrice = origMatch ? stripHtml(origMatch[1]) : undefined;

    // Price: matches numbers with 원 or 품절
    const priceMatch = bodyHtml.match(/font-size:\s*(?:22|26)px;[^"]*"[^>]*>[\s\S]*?([0-9,]+원|품절)/) ||
                       bodyHtml.match(/([0-9,]+원|품절)/);
    const price = priceMatch ? priceMatch[1] : '';

    // Price Description: (월 ...)
    const priceDescMatch = bodyHtml.match(/(\(월[^)]+\))/);
    const priceDesc = priceDescMatch ? priceDescMatch[1] : '';

    if (cardTitle || price) {
      cards.push({
        title: cardTitle,
        badge,
        duration,
        originalPrice,
        price,
        priceDesc,
        style,
      });
    }
  }

  return cards;
}

// CLI Execution
if (require.main === module) {
  const defaultHtmlPath = path.resolve(__dirname, '../../templates/ppompu-ad-design-system/ui_kits/ppompu-ad/redesign-v5v1.html');
  const defaultOutPath = path.resolve(__dirname, '../../templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml');

  const args = process.argv.slice(2);
  let htmlPath = defaultHtmlPath;
  let outPath = defaultOutPath;
  let printOnly = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      htmlPath = path.resolve(process.cwd(), args[++i]);
    } else if (args[i] === '--out' && args[i + 1]) {
      outPath = path.resolve(process.cwd(), args[++i]);
    } else if (args[i] === '--print') {
      printOnly = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  try {
    if (!fs.existsSync(htmlPath)) {
      console.error(`Input file not found: ${htmlPath}`);
      process.exit(4);
    }

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const adData = extractAdFields(htmlContent);

    if (jsonOutput) {
      console.log(JSON.stringify(adData, null, 2));
    } else {
      const yamlStr = yaml.stringify(adData, { indent: 2 });
      if (!printOnly) {
        fs.writeFileSync(outPath, yamlStr, 'utf8');
        console.log(`Successfully extracted fields from ${htmlPath} to ${outPath}`);
      }
      console.log(`\n=== Extracted Summary ===`);
      console.log(`Title: ${adData.header.title}`);
      console.log(`Nav Links: ${adData.navLinks.length} items`);
      console.log(`Sections: ${adData.sections.length} sections`);
      adData.sections.forEach(s => {
        const cardCount = s.subsections.reduce((acc, sub) => acc + sub.cards.length, 0);
        console.log(`  - [${s.id}] ${s.title}: ${cardCount} cards, ${s.notices.length} notices`);
      });
      console.log(`Extra Items: ${adData.extraSection.items.length} items`);
      console.log(`Footer: Contact ${adData.footer.phone}, Kakao ${adData.footer.kakaoLink}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Extraction error:', err);
    process.exit(1);
  }
}
