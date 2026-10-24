import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const schemaPath = path.resolve(__dirname, '../../templates/ppompu-ad-design-system/ui_kits/ppompu-ad/ad-data.yaml');
const outDir = path.resolve(__dirname, '../../templates/ppompu-ad-design-system/ui_kits/ppompu-ad/dist');
const outFile = path.resolve(outDir, 'index.html');

try {
  const fileContent = fs.readFileSync(schemaPath, 'utf8');
  const data = yaml.parse(fileContent);

  if (data.schemaVersion !== 'ad-1.0') {
    console.error(`Invalid schema version: ${data.schemaVersion}. Expected ad-1.0`);
    process.exit(4);
  }

  const html = generateHtml(data);
  
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  fs.writeFileSync(outFile, html, 'utf8');
  console.log(`Successfully generated ad template to ${outFile}`);
  process.exit(0);
} catch (error) {
  console.error('Error generating template:', error);
  process.exit(4);
}

function generateHtml(data: any): string {
  return `
<br>
<div style="background-color: #F2F0EB; padding: 2px 0 20px 0;">
   <div style="max-width: 800px; margin: 20px auto 0 auto; width: 100%; padding: 0 12px; box-sizing: border-box;">
      <div
         style="margin: 0 0 16px 0; width: 100%; box-sizing: border-box; background: #ffffff; border: 1px solid rgba(0,0,0,0.04); box-shadow: 0 4px 20px rgba(0,0,0,0.03); border-radius: 14px; padding: 10px 12px; font-size: 12px; color: #C87A53; display: flex; gap: 14px; flex-wrap: wrap; align-items: center;">
         <span style="font-weight: 700; color: #1e272c;">섹션이동:</span>
         ${data.navLinks.map((link: any) => `<a href="${link.id}" style="color: #C87A53; text-decoration: none; font-weight: 600;">${link.label}</a>`).join('')}
      </div>
      <div
         style="width: 100%; box-sizing: border-box; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px;">
         
         <div
            style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; padding: 32px 20px; text-align: center; border-bottom: 1px solid rgb(243, 244, 246); background: rgb(255, 255, 255);">
            <img src="${data.header.logoSrc}" alt="${data.header.logoAlt}"
               style="width: 100%; max-width: 600px; height: auto; display: block; margin: 0 auto 12px; border-radius: 6px; word-break: keep-all; overflow-wrap: break-word;" class="ne-image">
         </div>
         
         <div style="padding: 15px 20px;">
            <div
               style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 800px; margin: 0px auto 40px; text-align: center;">
               <h2 style="font-size: 20px; font-weight: 800; color: #1E1E1E; margin-bottom: 12px;">${data.header.title}</h2>
               <p
                  style="font-size: 14px; color: #7A7771; margin: 0 0 24px 0; line-height: 1.7; word-break: keep-all; overflow-wrap: break-word;">
                  ${data.header.subtitle}</p>
            </div>

            ${data.sections.map((section: any) => renderSection(section)).join('')}
            ${renderExtraSection(data.extraSection)}
            
            <div
               style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background-color: #ffffff; border-width: 1px 1px 1px 4px; border-style: solid; border-color: #E4E1DB rgb(226, 232, 240) rgb(226, 232, 240) rgb(30, 41, 59); border-image: initial; border-radius: 8px; margin-bottom: 44px; padding: 14px 12px; box-shadow: rgba(0, 0, 0, 0.03) 0px 4px 12px; word-break: keep-all; overflow-wrap: break-word;">
               <div
                  style="margin: 0 0 10px 0; font-size: 15px; font-weight: 800; color: #1E1E1E; display: flex; align-items: center; gap: 6px; line-height: 1.4; background-color: #ffffff;">
                  <span style="font-size: 18px;">📢</span> 필독 유의사항 및 보장 안내
               </div>
               <div style="font-size: 11.5px; color: #3E3C38; line-height: 1.65;"><strong style="color: #1E1E1E;">${data.footer.termsNotice}</strong><br></div>
            </div>

            <div id="section-start"
               style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background-color: #F2F0EB; border-radius: 16px; padding: 32px 20px; color: #1E1E1E; border: 1px solid rgb(226, 232, 240); scroll-margin-top: 72px;">
               <div style="text-align: center; margin-bottom: 32px;">
                  <h3 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 800; color: #1E1E1E;">지금 바로 시작하기</h3>
               </div>
               <div style="display: flex; flex-direction: column; align-items: center; gap: 32px;">
                  <div style="text-align: center; width: 100%;">
                     <p style="margin: 0 0 6px 0; font-size: 16px; color: #1E1E1E; font-weight: 700;">카카오톡 채널 상담 안내</p>
                     <p style="margin: 0 0 14px 0; font-size: 12px; color: #7A7771; line-height: 1.6;">카카오톡 채널을중심으로안내드리는 정식 구독관리프로세스로, 문의·신청을 남겨주시면 빠르게 답변드리겠습니다.</p>
                     <a href="${data.footer.kakaoLink}" target="_blank"
                        style="display: block; max-width: 360px; margin: 0 auto; background-color: #1E1E1E; color: white; padding: 18px 20px; border-radius: 16px; text-decoration: none; font-weight: 700; font-size: 16px; box-shadow: 0 8px 20px rgba(0,0,0,0.15); transition: transform 0.2s;">카카오톡채널로문의/신청하기</a>
                  </div>
                  <div style="position: relative; width: 100%; max-width: 240px; height: 1px; background-color: #E4E1DB;">
                     <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: rgb(241, 245, 249); padding: 0px 12px; color: rgb(148, 163, 184); font-weight: 600;">또는</span>
                  </div>
                  <div style="background-color: #ffffff; padding: 14px 12px; border-radius: 16px; border: 2px dashed #A3A09A; width: 100%; box-sizing: border-box; max-width: 480px;">
                     <div style="text-align: center; margin-bottom: 12px;"><span style="font-size: 20px; display: block; margin-bottom: 6px;">📩</span>
                        <p style="margin: 0; font-size: 15px; font-weight: 800; color: #1E1E1E;">문자로 직접 신청하기</p>
                        <p style="margin: 3px 0 0 0; font-size: 12px; color: #7A7771;">(가입 완료 후 결제 가능)</p>
                     </div>
                     <div style="font-size: 13px; color: #3E3C38; background-color: #F9F8F6; padding: 10px; border-radius: 8px; border: 1px solid #E4E1DB; line-height: 1.5;">
                        <div style="margin-bottom: 6px; font-weight: 700; color: #5C5A56; font-size: 12px;">작성 양식:</div>
                        <div style="font-family: monospace; color: #1E1E1E; word-break: break-all; line-height: 1.5; font-size: 12px;">이메일ID, 서비스명(기간), 금액, 입금자명</div>
                        <div style="margin-top: 8px; margin-bottom: 6px; font-weight: 700; color: #059669; font-size: 12px;">예시:</div>
                        <div style="font-family: monospace; color: #059669; word-break: break-all; line-height: 1.5; font-size: 12px;">your-email@example.com, youtube 12개월 개인, 50,000, 홍길동</div>
                     </div>
                  </div>
               </div>
               <div style="background-color: #ececec; border-radius: 16px; border: 1px solid #bcc8d6; margin-top: 10px; margin-bottom: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                  <div style="padding: 20px; text-align: center; background-color: #F9F8F6; border: 1px solid #e2e7ec; ">
                     <div style="font-size: 14px; color: #7A7771; margin-bottom: 8px; font-weight: 500;">담당자 연락처</div>
                     <div style="font-size: 20px; font-weight: 800; margin-bottom: 6px; color: #1E1E1E; letter-spacing: 0.5px;">${data.footer.phone}</div>
                  </div>
                  <div style="padding: 18px 14px; text-align: center; border-bottom: 1px solid #E4E1DB; background-color: #F9F8F6;border: 1px solid #e2e7ec; ">
                     <div style="font-size: 14px; color: #7A7771; margin-bottom: 8px; font-weight: 500;">입금 계좌</div>
                     <div style="font-size: 20px; font-weight: 800; margin-bottom: 6px; color: #1E1E1E; letter-spacing: 0.5px;">${data.footer.bankAccount}</div>
                     <div style="font-size: 15px; color: #3E3C38; font-weight: 600; line-height: 1.5;">${data.footer.bankDetails.replace(/\n/g, '<br>')}</div>
                  </div>
               </div>
            </div>
         </div>
         
         <div style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; padding: 24px 16px; border-top: 1px solid rgb(241, 245, 249); text-align: center; background-color: #fcfcfd;">
            <div style="font-size: 12px; color: #A3A09A; margin-bottom: 8px;">${data.footer.copyright}</div>
            <div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #7A7771;">&nbsp;</div>
         </div>
      </div>
   </div>
</div>
  `.trim();
}

function renderSection(section: any): string {
  const borderColors: Record<string, string> = {
    'section-youtube': 'rgba(0, 0, 0, 0.06)',
    'google-ai': 'rgba(0,0,0,0.06)',
    'picsart': '#C87A53',
    'section-adobe': '#1E1E1E',
    'section-lovable': '#C87A53',
    'section-notion': 'rgba(0,0,0,0.06)',
    'section-n8n': '#C87A53',
    'section-surfshark': '#C87A53',
    'section-coursera': '#C87A53',
  };
  const borderColor = borderColors[section.id] || 'rgba(0,0,0,0.06)';
  
  return `
    <div id="${section.id}" style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; margin-bottom: 36px; scroll-margin-top: 60px;">
       <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px; border-bottom: ${borderColor.includes('rgba') ? '1px' : '2px'} solid ${borderColor}; padding-bottom: 8px;">
          <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #1E1E1E;">${section.title}</h3>
       </div>
       
       ${(section.subsections || []).map((sub: any) => renderSubsection(sub)).join('')}
       
       ${renderNotices(section.notices || [])}
    </div>
  `;
}

function renderSubsection(sub: any): string {
  let labelHtml = '';
  if (sub.label) {
    labelHtml = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
         <span style="display: inline-block; background-color: #3E3C38; color: #ffffff; font-size: 11px; font-weight: 700; padding: 3px 12px; border-radius: 999px;">${sub.label}</span>
         <span style="font-size: 12px; color: #7A7771;">${sub.desc}</span>
      </div>
    `;
  }
  
  return `
    <div style="margin-bottom: 24px;">
      ${labelHtml}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
         ${(sub.cards || []).map((card: any) => renderCard(card)).join('')}
      </div>
    </div>
  `;
}

function renderCard(card: any): string {
  const isBest = card.style === 'best';
  const isPro = card.style === 'pro';
  
  let borderColor = 'rgba(0,0,0,0.04)';
  let borderTop = isBest ? 'none' : '4px solid #3E3C38';
  let badgeBg = '#3E3C38';
  let badgeColor = '#ffffff';
  let titleColor = '#3E3C38';
  let priceColor = '#1E1E1E';
  let descColor = '#7A7771';

  if (isBest) {
    borderColor = '#1E1E1E';
    borderTop = 'none';
    badgeBg = '#1E1E1E';
    titleColor = '#1E1E1E';
    priceColor = '#1E1E1E';
    descColor = '#1E1E1E';
  } else if (isPro) {
    borderColor = '#C87A53';
    borderTop = 'none';
    badgeBg = '#C87A53';
    titleColor = '#1E1E1E';
    priceColor = '#C87A53';
    descColor = '#C87A53';
  }

  const borderCss = borderTop !== 'none' 
    ? `border: 1px solid ${borderColor}; border-top: ${borderTop};` 
    : `border: 2px solid ${borderColor};`;

  const badgeHtml = card.badge ? `<span style="font-size: 10px; background-color: ${badgeBg}; color: ${badgeColor}; padding: 1px 6px; border-radius: 99px; font-weight: 600;">${card.badge}</span>` : '';
  const originalPriceHtml = card.originalPrice ? `<div style="font-size: 11px; color: #A3A09A; text-decoration: line-through; margin-bottom: 2px;">${card.originalPrice}</div>` : '';

  return `
    <div style="${borderCss} border-radius: 16px; overflow: hidden; background-color: #F9F8F6; box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column;">
       <div style="background-color: #FAF6F3; padding: 10px 14px; border-bottom: 1px solid #E4E1DB; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 12px; font-weight: 700; color: ${titleColor}; white-space: nowrap;">${card.title}</span>
          ${badgeHtml}
       </div>
       <div style="padding: 16px 12px; text-align: center; background-color: #ffffff; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center;">
          ${card.duration ? `<div style="font-size: 12px; font-weight: 700; color: #5C5A56; margin-bottom: 4px;">${card.duration}</div>` : ''}
          ${originalPriceHtml}
          <div style="font-size: 22px; font-weight: 800; color: ${priceColor}; margin-bottom: 2px;">${card.price}</div>
          <span style="font-size: 11px; color: ${descColor};">${card.priceDesc}</span>
       </div>
    </div>
  `;
}

function renderNotices(notices: any[]): string {
  if (!notices || notices.length === 0) return '';
  
  return `
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px;">
      ${notices.map((notice: any) => {
        const contentLines = notice.content.trim().split('\n');
        const formattedContent = contentLines.map((line: string) => `<div style="margin-bottom: 4px; color: #3E3C38;">${line.replace(/• /g, '• <b>').replace(/:/g, ':</b>')}</div>`).join('');
        
        if (notice.type === 'details') {
          return `
            <details style="background-color: #F9F8F6; border-width: 1px 1px 1px 4px; border-style: solid; border-color: #E4E1DB #E4E1DB #E4E1DB #DDA78A; border-radius: 8px; line-height: 1.65; cursor: pointer;" open="">
               <summary style="color: #92400e; font-size: 13px; padding: 12px 16px; font-weight: 700; outline: none; list-style-position: inside;">
                  ${notice.title}
               </summary>
               <div style="padding: 0px 16px 12px; margin-top: -4px;">
                  ${formattedContent}
               </div>
            </details>
          `;
        } else {
          return `
            <div style="padding: 12px 16px; background-color: #F9F8F6; border-left: 4px solid #1E1E1E; border-radius: 8px; font-size: 12px; line-height: 1.65; border-top: 1px solid #E4E1DB; border-right: 1px solid #E4E1DB; border-bottom: 1px solid #E4E1DB; color: #3E3C38;">
               <strong style="color: #1E1E1E; display: block; margin-bottom: 6px; font-size: 13px;">${notice.title}</strong>
               ${formattedContent}
            </div>
          `;
        }
      }).join('')}
    </div>
  `;
}

function renderExtraSection(extra: any): string {
  if (!extra) return '';
  return `
    <div id="${extra.id}" style="font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; margin-bottom: 36px; scroll-margin-top: 72px;">
       <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px; border-bottom: 2px solid #5C5A56; padding-bottom: 8px;">
          <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #1E1E1E;">${extra.title}</h3>
       </div>

       <div style="background-color: #ffffff; border: 1px solid #E4E1DB; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
          <div style="background-color: #F9F8F6; padding: 12px 16px; border-bottom: 1px solid #E4E1DB; display: flex; font-size: 13px; font-weight: 700; color: #5C5A56;">
             <div style="flex: 2;">상품명</div>
             <div style="flex: 1; text-align: center;">이용기간</div>
             <div style="flex: 1; text-align: right;">특가 (KRW)</div>
          </div>
          <div style="display: flex; flex-direction: column;">
             ${extra.items.map((item: any) => `
             <div style="padding: 12px 16px; border-bottom: 1px solid #F2F0EB; display: flex; font-size: 13px; color: #1E1E1E; align-items: center;">
                <div style="flex: 2; font-weight: 600;">${item.name}</div>
                <div style="flex: 1; text-align: center; color: #7A7771;">${item.duration}</div>
                <div style="flex: 1; text-align: right; font-weight: 800; color: #C87A53;">${item.price}</div>
             </div>
             `).join('')}
          </div>
       </div>

       <div style="margin-top: 12px; padding: 10px 16px; background-color: #F9F8F6; border-radius: 8px; font-size: 12px; color: #5C5A56; border: 1px solid #E4E1DB; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 14px;">⏱️</span>
          ${extra.deliveryNote}
       </div>
    </div>
  `;
}
