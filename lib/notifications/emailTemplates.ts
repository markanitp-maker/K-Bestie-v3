type EmailTemplate = {
  subject: string;
  html: string;
};

export function getEmailTemplate(eventType: string): EmailTemplate {
  switch (eventType) {
    case "unsubscribe_requested":
      return {
        subject: "[K-Bestie] 서비스 해지 접수 안내",
        html: "<p>회원님의 서비스 해지 요청이 정상적으로 접수되었습니다.</p><p>현재 유예 기간이 적용되며, 이 기간 내에 해지를 취소할 수 있습니다.</p>",
      };
    case "grace_period_started":
      return {
        subject: "[K-Bestie] 계정 삭제 유예 기간 시작 안내",
        html: "<p>회원님의 계정 삭제 유예 기간이 시작되었습니다.</p><p>유예 기간이 종료되면 계정 및 모든 데이터가 영구적으로 삭제됩니다.</p>",
      };
    case "restore_requested":
      return {
        subject: "[K-Bestie] 계정 복구 완료 안내",
        html: "<p>회원님의 계정이 성공적으로 복구되었습니다.</p><p>이제 정상적으로 서비스를 이용하실 수 있습니다.</p>",
      };
    case "deletion_warning_7d":
      return {
        subject: "[K-Bestie] 계정 데이터 삭제 7일 전 안내",
        html: "<p>7일 후 회원님의 계정과 모든 데이터가 완전히 삭제됩니다.</p><p>삭제를 원치 않으실 경우, 앱에서 복구를 진행해 주세요.</p>",
      };
    case "deletion_warning_1d":
      return {
        subject: "[K-Bestie] 계정 데이터 삭제 1일 전 안내",
        html: "<p>1일 후 회원님의 계정과 모든 데이터가 완전히 삭제됩니다.</p><p>삭제된 데이터는 복구할 수 없습니다.</p>",
      };
    case "deleted":
      return {
        subject: "[K-Bestie] 계정 삭제 완료 안내",
        html: "<p>회원님의 계정과 모든 데이터가 완전히 삭제되었습니다.</p><p>그동안 K-Bestie를 이용해 주셔서 감사합니다.</p>",
      };
    default:
      return {
        subject: `[K-Bestie] 계정 안내: ${eventType}`,
        html: `<p>계정 상태 변경 안내: <strong>${eventType}</strong></p><p>자세한 사항은 앱을 확인해 주세요.</p>`,
      };
  }
}
