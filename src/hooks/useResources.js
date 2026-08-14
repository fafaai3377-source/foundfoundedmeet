import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export function useResources() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "resources"), (snapshot) => {
      const resData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      // 정렬: order 속성 오름차순
      resData.sort((a, b) => (a.order || 0) - (b.order || 0));
      setResources(resData);
      setLoading(false);
    }, (error) => {
      console.error("자원(resources) 정보를 불러오는 중 에러 발생:", error);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { resources, loading };
}
